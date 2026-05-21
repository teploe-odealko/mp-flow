import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const specRoot = path.join(repoRoot, "docs", "spec", "steps");
const appRoot = repoRoot;
const frontendFiles = collectFrontendFiles(path.join(appRoot, "src", "frontend"));
const backendFiles = [path.join(appRoot, "src", "backend", "app.ts")];
const outPath = path.join(appRoot, "tmp", "spec-contract-audit.json");

const frontendSource = frontendFiles.map(readIfExists).join("\n");
const backendSource = backendFiles.map(readIfExists).join("\n");
const implementedRoutes = new Set([...frontendSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => normalizeRoute(match[1])));
const implementedEndpoints = new Set(
  [...backendSource.matchAll(/api\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((match) => `${match[1].toUpperCase()} ${normalizeApiPath(match[2])}`)
);
const implementedLabels = new Set(
  [...frontendSource.matchAll(/(?:label|submitLabel|title|aria-label|placeholder)=["{]`?([^"`{}]{2,90})/g)]
    .map((match) => normalizeLabel(match[1]))
    .filter(Boolean)
);

const steps = fs.readdirSync(specRoot).sort().flatMap((stepName) => {
  const specPath = path.join(specRoot, stepName, "spec.md");
  if (!fs.existsSync(specPath)) return [];
  const spec = fs.readFileSync(specPath, "utf8");
  const expectedRoutes = unique(
    [...spec.matchAll(/`(\/(?!api\/)[^`\s)]+)`/g)]
      .map((match) => normalizeRoute(match[1]))
      .filter((route) => route !== "/")
  );
  const expectedEndpoints = unique(
    [...spec.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9_:/?=&.{}-]+)/g)]
      .map((match) => `${match[1]} ${normalizeApiPath(match[2])}`)
  );
  const expectedRenders = unique([...spec.matchAll(/!\[[^\]]*]\((renders\/[^)]+\.png)\)/g)].map((match) => match[1]));
  const expectedLabels = unique(
    [...spec.matchAll(/`([^`]{2,70})`/g)]
      .map((match) => normalizeLabel(match[1]))
      .filter((label) => label && /[А-Яа-яЁё]/.test(label))
      .filter((label) => !label.startsWith("/") && !label.startsWith("Дт ") && !label.startsWith("Кт "))
      .filter((label) => !/\b(api|json|uuid|id|status|source|target|date|amount|fifo)\b/i.test(label))
      .filter((label) => !technicalSpecFragment(label))
  );

  const missingEndpoints = expectedEndpoints.filter((endpoint) => !endpointImplemented(endpoint, implementedEndpoints));
  const missingRoutes = expectedRoutes.filter((route) => !routeImplemented(route, implementedRoutes));
  const missingRenders = expectedRenders.filter((render) => !fs.existsSync(path.join(specRoot, stepName, render)));
  const missingLabels = expectedLabels.filter((label) => !labelImplemented(label, implementedLabels, frontendSource));

  return [{
    step: stepName,
    expected: {
      endpoints: expectedEndpoints.length,
      routes: expectedRoutes.length,
      renders: expectedRenders.length,
      labels: expectedLabels.length
    },
    missingEndpoints,
    missingRoutes,
    missingRenders,
    missingLabels: missingLabels.slice(0, 80)
  }];
});

const summary = {
  generatedAt: new Date().toISOString(),
  implemented: {
    endpoints: implementedEndpoints.size,
    routes: implementedRoutes.size,
    labels: implementedLabels.size
  },
  expected: {
    endpoints: steps.reduce((sum, step) => sum + step.expected.endpoints, 0),
    routes: steps.reduce((sum, step) => sum + step.expected.routes, 0),
    renders: steps.reduce((sum, step) => sum + step.expected.renders, 0),
    labels: steps.reduce((sum, step) => sum + step.expected.labels, 0)
  },
  missing: {
    endpoints: steps.reduce((sum, step) => sum + step.missingEndpoints.length, 0),
    routes: steps.reduce((sum, step) => sum + step.missingRoutes.length, 0),
    renders: steps.reduce((sum, step) => sum + step.missingRenders.length, 0),
    labels: steps.reduce((sum, step) => sum + step.missingLabels.length, 0)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({ summary, steps }, null, 2)}\n`);

console.table(steps.map((step) => ({
  step: step.step,
  endpoints: `${step.expected.endpoints - step.missingEndpoints.length}/${step.expected.endpoints}`,
  routes: `${step.expected.routes - step.missingRoutes.length}/${step.expected.routes}`,
  renders: `${step.expected.renders - step.missingRenders.length}/${step.expected.renders}`,
  labels: `${step.expected.labels - step.missingLabels.length}/${step.expected.labels}`
})));
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${outPath}`);

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function collectFrontendFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeRoute(route) {
  return route
    .replace(/\?.*$/, "")
    .replace(/<[^/]+>/g, ":id")
    .replace(/\.\.\./g, ":id")
    .replace(/:documentId|:linkedId|:accountId|:saleId|:projectId|:periodId|:entryId/g, ":id");
}

function normalizeApiPath(route) {
  return route
    .replace(/\?.*$/, "")
    .replace(/\{[^}]+}/g, ":id")
    .replace(/<[^/]+>/g, ":id")
    .replace(/:documentId|:linkedId|:accountId|:saleId|:projectId|:periodId|:entryId|:channelId|:id/g, ":id");
}

function normalizeLabel(label) {
  return label
    .replace(/\$\{[^}]+}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function technicalSpecFragment(label) {
  const normalized = label.toLowerCase();
  return (
    label.startsWith("text ") ||
    label.startsWith(". ") ||
    label.startsWith(";") ||
    label.startsWith(":") ||
    label.startsWith("totals.") ||
    label.includes("##") ||
    normalized.includes(" not null ") ||
    normalized.includes("учетные правила") ||
    normalized.includes("ошибки пользователя")
  );
}

function endpointImplemented(endpoint, implemented) {
  if (implemented.has(endpoint)) return true;
  const [method, pathName] = endpoint.split(" ");
  const aliasCandidates = endpointAliases(pathName).map((alias) => `${method} ${alias}`);
  return aliasCandidates.some((candidate) => implemented.has(candidate));
}

function endpointAliases(pathName) {
  const aliases = new Set([pathName]);
  aliases.add(pathName.replace("/accounting/accounts", "/accounts"));
  aliases.add(pathName.replace("/accounting/journal", "/journal"));
  aliases.add(pathName.replace("/accounting/ledger", "/ledger"));
  aliases.add(pathName.replace("/integrations/plugins", "/plugins"));
  aliases.add(pathName.replace("/integrations/channels", "/channels"));
  aliases.add(pathName.replace("/finance/expenses", "/expenses"));
  aliases.add(pathName.replace("/finance/payouts", "/payouts"));
  aliases.add(pathName.replace("/accounting-periods", "/periods"));
  return [...aliases];
}

function routeImplemented(route, implemented) {
  if (implemented.has(route)) return true;
  return [...implemented].some((candidate) => {
    const pattern = `^${candidate.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*")}$`;
    return new RegExp(pattern).test(route);
  });
}

function labelImplemented(label, implemented, source) {
  if (implemented.has(label)) return true;
  if (source.includes(label)) return true;
  const compact = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (compact.length < 4) return true;
  return source.toLowerCase().includes(compact);
}
