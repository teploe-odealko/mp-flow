// Настройка CORS на S3-бакете медиа фотостудии.
// ОБЯЗАТЕЛЬНО запустить один раз на каждый бакет: без CORS браузер не сможет
// делать presigned-PUT напрямую в хранилище (cross-origin), а агент/curl — смогут.
// Запуск: node scripts/setup-s3-cors.mjs   (читает креды из .env)
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const bucket = process.env.S3_BUCKET;
if (!bucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
  console.error("Заполните S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY в .env");
  process.exit(1);
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "ru-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
});

const CORSConfiguration = {
  CORSRules: [
    {
      // presigned-URL сам по себе является авторизацией, поэтому origin можно держать широким.
      AllowedOrigins: ["*"],
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600
    }
  ]
};

await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration }));
const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`✅ CORS настроен на бакете ${bucket}:`);
console.log(JSON.stringify(current.CORSRules, null, 2));
