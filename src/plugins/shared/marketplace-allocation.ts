export type MarketplaceAutoAllocateDestinationInput = {
  destinationId: string;
  recommendedQty: number;
  demand30dQty: number;
  averageDeliveryHours: number | null;
  attentionLevel: string | null;
};

export type MarketplaceAutoAllocateItemInput = {
  itemId: string;
  totalQty: number;
  minClusterQty: number;
  destinations: MarketplaceAutoAllocateDestinationInput[];
};

export type MarketplaceAutoAllocateInput = {
  items: MarketplaceAutoAllocateItemInput[];
  selectedDestinationIds: string[];
};

export type MarketplaceAutoAllocateResult = {
  allocations: Array<{
    destinationId: string;
    itemId: string;
    qty: number;
  }>;
  notes: string[];
  errors: string[];
};

type Candidate = MarketplaceAutoAllocateDestinationInput & {
  score: number;
};

export function buildSuggestedMarketplaceAllocations(input: MarketplaceAutoAllocateInput): MarketplaceAutoAllocateResult {
  const selectedDestinationIds = Array.from(new Set(input.selectedDestinationIds));
  const allocations: MarketplaceAutoAllocateResult["allocations"] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  if (selectedDestinationIds.length === 0) {
    return {
      allocations: [],
      notes: [],
      errors: ["Не выбраны кластеры для распределения."]
    };
  }

  for (const item of input.items) {
    const totalQty = normalizeWholeNonNegative(item.totalQty);
    if (totalQty <= 0) continue;
    const minClusterQty = Math.max(0, normalizeWholeNonNegative(item.minClusterQty));
    const candidates = item.destinations
      .filter((destination) => selectedDestinationIds.includes(destination.destinationId))
      .map((destination) => ({
        ...destination,
        score: buildCandidateScore(destination)
      }));

    if (candidates.length === 0) {
      errors.push(`Для ${item.itemId} нет выбранных кластеров.`);
      continue;
    }

    if (minClusterQty > 0 && totalQty < candidates.length * minClusterQty) {
      errors.push(
        `Для ${item.itemId} нужно минимум ${formatInt(minClusterQty)} шт. на каждый из ${formatInt(candidates.length)} выбранных кластеров, а доступно только ${formatInt(totalQty)} шт.`
      );
      continue;
    }

    const allocatedByDestination = allocateItemAcrossDestinations({
      totalQty,
      minClusterQty,
      candidates
    });

    for (const candidate of candidates) {
      const qty = allocatedByDestination.get(candidate.destinationId) ?? 0;
      if (qty > 0) {
        allocations.push({
          destinationId: candidate.destinationId,
          itemId: item.itemId,
          qty: round4(qty)
        });
      }
    }

    if (minClusterQty > 0) {
      notes.push(`Для ${item.itemId} сначала заложили по ${formatInt(minClusterQty)} шт. на каждый выбранный кластер, остаток распределили по рекомендациям.`);
    }
    if (candidates.every((candidate) => normalizeNonNegative(candidate.recommendedQty) <= 0)) {
      notes.push(`Для ${item.itemId} нет явных рекомендаций по спросу, поэтому после минимального распределения остаток делили между выбранными кластерами равномерно.`);
    }
  }

  if (errors.length > 0) {
    return { allocations: [], notes, errors };
  }

  if (allocations.length === 0) {
    notes.push("Алгоритм не смог предложить распределение.");
  }

  return { allocations, notes, errors };
}

function allocateItemAcrossDestinations(input: {
  totalQty: number;
  minClusterQty: number;
  candidates: Candidate[];
}) {
  const { totalQty, minClusterQty, candidates } = input;
  const allocation = new Map<string, number>(candidates.map((candidate) => [candidate.destinationId, 0]));
  const totalScore = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
  const normalizedScore = totalScore > 0 ? totalScore : candidates.length;
  const remainders: Array<{
    destinationId: string;
    remainder: number;
    score: number;
    attentionLevel: string | null;
    averageDeliveryHours: number | null;
  }> = [];

  let assigned = 0;
  if (minClusterQty > 0) {
    for (const candidate of candidates) {
      allocation.set(candidate.destinationId, minClusterQty);
      assigned += minClusterQty;
    }
  }

  const remainingQty = totalQty - assigned;
  for (const candidate of candidates) {
    const basis = totalScore > 0 ? candidate.score : 1;
    const idealQty = (remainingQty * basis) / normalizedScore;
    const floorQty = Math.floor(idealQty);
    allocation.set(candidate.destinationId, (allocation.get(candidate.destinationId) ?? 0) + floorQty);
    assigned += floorQty;
    remainders.push({
      destinationId: candidate.destinationId,
      remainder: idealQty - floorQty,
      score: candidate.score,
      attentionLevel: candidate.attentionLevel,
      averageDeliveryHours: candidate.averageDeliveryHours
    });
  }

  let remainderUnits = totalQty - assigned;
  const remainderRanking = [...remainders].sort((left, right) =>
    right.remainder - left.remainder
    || right.score - left.score
    || compareAttention(right.attentionLevel, left.attentionLevel)
    || compareHoursDesc(right.averageDeliveryHours, left.averageDeliveryHours)
    || left.destinationId.localeCompare(right.destinationId)
  );

  let index = 0;
  while (remainderUnits > 0 && remainderRanking.length > 0) {
    const candidate = remainderRanking[index % remainderRanking.length]!;
    allocation.set(candidate.destinationId, (allocation.get(candidate.destinationId) ?? 0) + 1);
    remainderUnits -= 1;
    index += 1;
  }

  return allocation;
}

function buildCandidateScore(destination: MarketplaceAutoAllocateDestinationInput) {
  const recommendation = normalizeNonNegative(destination.recommendedQty);
  const baseQty = recommendation > 0 ? recommendation : 1;
  const attentionFactor = getAttentionFactor(destination.attentionLevel);
  const deliveryFactor = destination.averageDeliveryHours != null
    ? 1 + Math.min(Math.max(destination.averageDeliveryHours, 0), 120) / 240
    : 1;
  return round4(baseQty * attentionFactor * deliveryFactor);
}

function getAttentionFactor(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HI" || normalized === "HIGH") return 1.25;
  if (normalized === "MEDIUM") return 1.1;
  return 1;
}

function compareAttention(left: string | null, right: string | null) {
  return attentionRank(left) - attentionRank(right);
}

function attentionRank(value: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HI" || normalized === "HIGH") return 3;
  if (normalized === "MEDIUM") return 2;
  if (normalized === "LOW") return 1;
  return 0;
}

function compareHoursDesc(left: number | null, right: number | null) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return leftValue - rightValue;
}

function normalizeWholeNonNegative(value: number) {
  return Math.max(0, Math.round(normalizeNonNegative(value)));
}

function normalizeNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function formatInt(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}
