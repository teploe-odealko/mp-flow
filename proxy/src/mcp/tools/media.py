import base64
import logging
import uuid
from io import BytesIO

import httpx
from proxy.src.config import settings
from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result

logger = logging.getLogger(__name__)

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def media_generate_image(
    prompt: str,
    resolution: str = "1K",
    input_image_urls: list[str] | None = None,
) -> str:
    """Generate or edit an image using Gemini 3 Pro Image model.
    Uploads result to S3 and returns the URL.

    Args:
        prompt: Image description or editing instruction (required).
        resolution: Output resolution — '1K', '2K', or '4K' (default '1K').
        input_image_urls: Optional list of image URLs for editing/composition (up to 14).
    """
    if not settings.gemini_api_key:
        raise ValueError("Gemini API not configured")

    if resolution not in ("1K", "2K", "4K"):
        raise ValueError(f"Invalid resolution '{resolution}'. Must be 1K, 2K, or 4K")

    deps = get_deps()
    input_urls = input_image_urls or []

    if len(input_urls) > 14:
        raise ValueError(f"Too many input images ({len(input_urls)}). Maximum is 14.")

    # Build contents parts
    contents_parts: list[dict] = []

    # Load input images from URLs
    if input_urls:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for img_url in input_urls:
                try:
                    resp = await client.get(img_url)
                    if resp.status_code >= 400:
                        continue
                    ct = resp.headers.get("content-type", "image/jpeg")
                    mime = (
                        "image/png"
                        if "png" in ct
                        else ("image/webp" if "webp" in ct else "image/jpeg")
                    )
                    data = base64.b64encode(resp.content).decode()
                    contents_parts.append({"inline_data": {"mime_type": mime, "data": data}})
                except Exception as e:
                    logger.warning(f"Error loading image {img_url}: {e}")

    contents_parts.append({"text": prompt})

    # Call Gemini Image API
    model = "gemini-3-pro-image-preview"
    payload = {
        "contents": [{"parts": contents_parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"imageSize": resolution},
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"Content-Type": "application/json", "x-goog-api-key": settings.gemini_api_key},
            json=payload,
        )

    if response.status_code >= 400:
        raise ValueError(f"Gemini API error: {response.status_code} - {response.text[:500]}")

    data = response.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No response from Gemini")

    parts = candidates[0].get("content", {}).get("parts", [])
    image_b64: str | None = None
    text_response: str | None = None

    for part in parts:
        if "text" in part:
            text_response = part["text"]
        elif "inlineData" in part:
            image_b64 = part["inlineData"].get("data", "")

    if not image_b64:
        raise ValueError("No image was generated")

    # Upload to S3
    result_url = None
    try:
        import boto3

        s3 = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        image_bytes = base64.b64decode(image_b64)
        filename = f"generated/{uuid.uuid4().hex}.png"
        s3_key = f"users/{deps.user_id}/{filename}"
        s3.upload_fileobj(
            BytesIO(image_bytes),
            settings.s3_bucket,
            s3_key,
            ExtraArgs={"ContentType": "image/png"},
        )
        result_url = f"{settings.base_url}/v1/files/{deps.user_id}/{filename}"
    except Exception as e:
        logger.error(f"S3 upload failed: {e}")
        # Fallback: return truncated base64 indicator
        result_url = None

    usage = data.get("usageMetadata", {})
    result = {
        "url": result_url,
        "text": text_response,
        "model": model,
        "resolution": resolution,
        "usage": {
            "input_tokens": usage.get("promptTokenCount", 0),
            "output_tokens": usage.get("candidatesTokenCount", 0),
        },
    }
    if not result_url:
        result["image_base64_truncated"] = image_b64[:100] + "..."
        result["note"] = "S3 upload failed. Image was generated but could not be stored."

    return serialize_result(result)
