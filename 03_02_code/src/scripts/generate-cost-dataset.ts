import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface DepartmentConfig {
  folder: string;
  code: string;
  costCenter: string;
  spendMultiplier: number;
}

interface CategoryConfig {
  category: string;
  subcategories: string[];
  vendors: string[];
  weight: number;
}

interface LineItem {
  id: string;
  date: string;
  category: string;
  subcategory: string;
  vendor: string;
  project_code: string;
  description: string;
  region: string;
  recurring: boolean;
  approval_tier: 'manager' | 'director' | 'vp' | 'cfo';
  amount: number;
}

const DATA_ROOT = resolve(process.cwd(), 'workspace', 'data', 'costs', '2026');

const departments: DepartmentConfig[] = [
  { folder: 'engineering', code: 'ENG', costCenter: 'CC-100', spendMultiplier: 1.5 },
  { folder: 'product', code: 'PRD', costCenter: 'CC-110', spendMultiplier: 1.15 },
  { folder: 'design', code: 'DSN', costCenter: 'CC-120', spendMultiplier: 0.85 },
  { folder: 'marketing', code: 'MKT', costCenter: 'CC-200', spendMultiplier: 1.25 },
  { folder: 'sales', code: 'SLS', costCenter: 'CC-210', spendMultiplier: 1.4 },
  { folder: 'customer-success', code: 'CSM', costCenter: 'CC-220', spendMultiplier: 0.95 },
  { folder: 'finance', code: 'FIN', costCenter: 'CC-300', spendMultiplier: 0.75 },
  { folder: 'hr', code: 'HR', costCenter: 'CC-310', spendMultiplier: 0.7 },
  { folder: 'operations', code: 'OPS', costCenter: 'CC-400', spendMultiplier: 1.05 },
  { folder: 'security', code: 'SEC', costCenter: 'CC-410', spendMultiplier: 0.9 },
];

const categories: CategoryConfig[] = [
  {
    category: 'Cloud Infrastructure',
    subcategories: ['Compute', 'Storage', 'Network'],
    vendors: ['AWS', 'GCP', 'Azure'],
    weight: 1.6,
  },
  {
    category: 'Software Licenses',
    subcategories: ['Productivity', 'Developer Tools', 'Business Apps'],
    vendors: ['Atlassian', 'GitHub', 'Notion', 'Figma', 'Salesforce'],
    weight: 1.15,
  },
  {
    category: 'Consulting and Services',
    subcategories: ['Implementation', 'Advisory', 'Managed Services'],
    vendors: ['Accenture', 'Deloitte', 'Local Partners'],
    weight: 1.25,
  },
  {
    category: 'People Programs',
    subcategories: ['Recruiting', 'Training', 'Wellness'],
    vendors: ['LinkedIn', 'Coursera', 'Wellhub'],
    weight: 0.9,
  },
  {
    category: 'Travel and Events',
    subcategories: ['Conferences', 'Onsites', 'Customer Meetings'],
    vendors: ['Global Travel Desk', 'Event Agency'],
    weight: 1.05,
  },
  {
    category: 'Risk and Compliance',
    subcategories: ['Audits', 'Legal', 'Insurance'],
    vendors: ['AuditPro', 'Smith & Forge LLP', 'Global Risk'],
    weight: 0.95,
  },
  {
    category: 'AI and Data',
    subcategories: ['Model APIs', 'Data Platform', 'ML Ops'],
    vendors: ['OpenAI', 'Anthropic', 'Databricks'],
    weight: 1.35,
  },
];

const regions = ['NA', 'EMEA', 'APAC', 'LATAM'] as const;
const approvalTiers = ['manager', 'director', 'vp', 'cfo'] as const;
const budgetBuckets = ['run', 'change'] as const;

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let z = t;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
};

const toMonth = (month: number): string => String(month).padStart(2, '0');

const randomInt = (next: () => number, min: number, max: number): number =>
  Math.floor(next() * (max - min + 1)) + min;

const pick = <T>(next: () => number, values: readonly T[]): T => {
  const index = randomInt(next, 0, values.length - 1);
  return values[index] as T;
};

const weightedPickCategory = (next: () => number): CategoryConfig => {
  const totalWeight = categories.reduce((sum, item) => sum + item.weight, 0);
  let cursor = next() * totalWeight;
  for (const item of categories) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return categories[categories.length - 1] as CategoryConfig;
};

const seasonalFactor = (month: number): number => {
  if (month >= 10) return 1.18;
  if (month >= 7) return 1.08;
  if (month <= 2) return 0.92;
  return 1;
};

const createLineItem = (
  next: () => number,
  department: DepartmentConfig,
  month: number,
  bucket: (typeof budgetBuckets)[number],
  index: number,
): LineItem => {
  const period = `2026-${toMonth(month)}`;
  const category = weightedPickCategory(next);
  const subcategory = pick(next, category.subcategories);
  const vendor = pick(next, category.vendors);
  const region = pick(next, regions);
  const approvalTier = pick(next, approvalTiers);
  const day = String(randomInt(next, 1, 28)).padStart(2, '0');
  const recurring = next() > 0.62;

  const bucketFactor = bucket === 'run' ? 1.18 : 0.92;
  const approvalFactor = approvalTier === 'cfo' ? 1.55 : approvalTier === 'vp' ? 1.3 : approvalTier === 'director' ? 1.1 : 1;
  const base = randomInt(next, 450, 6200);
  const amount = Number(
    (
      base
      * department.spendMultiplier
      * category.weight
      * bucketFactor
      * approvalFactor
      * seasonalFactor(month)
    ).toFixed(2),
  );

  return {
    id: `${department.code}-${period}-${bucket}-${String(index + 1).padStart(3, '0')}`,
    date: `2026-${toMonth(month)}-${day}`,
    category: category.category,
    subcategory,
    vendor,
    project_code: `PRJ-${department.code}-${String(randomInt(next, 10, 99))}`,
    description: `${subcategory} spend for ${department.folder} (${bucket})`,
    region,
    recurring,
    approval_tier: approvalTier,
    amount,
  };
};

const generateDataset = async (): Promise<void> => {
  await rm(DATA_ROOT, { recursive: true, force: true });
  await mkdir(DATA_ROOT, { recursive: true });

  const random = mulberry32(hashString('03_02_code-2026-large-cost-dataset'));

  let totalFiles = 0;
  let totalLineItems = 0;
  let grandTotal = 0;

  for (const department of departments) {
    const departmentDir = join(DATA_ROOT, department.folder);
    await mkdir(departmentDir, { recursive: true });

    for (let month = 1; month <= 12; month += 1) {
      for (const bucket of budgetBuckets) {
        const lineItemCount = randomInt(random, bucket === 'run' ? 45 : 26, bucket === 'run' ? 72 : 48);
        const lineItems = Array.from({ length: lineItemCount }, (_, index) =>
          createLineItem(random, department, month, bucket, index),
        );

        const payload = {
          department: department.folder,
          department_code: department.code,
          cost_center: department.costCenter,
          period: `2026-${toMonth(month)}`,
          budget_bucket: bucket,
          currency: 'USD',
          generated_at: new Date().toISOString(),
          line_items: lineItems,
        };

        const filename = `${payload.period}-${bucket}.json`;
        await writeFile(join(departmentDir, filename), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

        totalFiles += 1;
        totalLineItems += lineItems.length;
        grandTotal += lineItems.reduce((sum, item) => sum + item.amount, 0);
      }
    }
  }

  const readme = [
    '# 2026 Large Cost Dataset',
    '',
    'Generated synthetic enterprise spending data for code-execution reporting demos.',
    '',
    '## Structure',
    '- Separate folder per department',
    '- 12 months x 2 budget buckets (`run`, `change`) per department',
    '- Rich line-item metadata (`category`, `subcategory`, `vendor`, `approval_tier`, `region`, etc.)',
    '',
    '## Scale',
    `- Departments: ${departments.length}`,
    `- JSON files: ${totalFiles}`,
    `- Line items: ${totalLineItems}`,
    `- Grand total (USD): ${grandTotal.toFixed(2)}`,
    '',
    'This size is intended to be expensive to pass through LLM context directly,',
    'while still practical to aggregate quickly using sandboxed code execution.',
    '',
  ].join('\n');

  await writeFile(join(DATA_ROOT, 'README.md'), readme, 'utf-8');

  console.log(
    JSON.stringify(
      {
        departments: departments.length,
        files: totalFiles,
        line_items: totalLineItems,
        grand_total_usd: Number(grandTotal.toFixed(2)),
        path: DATA_ROOT,
      },
      null,
      2,
    ),
  );
};

generateDataset().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate dataset: ${message}`);
  process.exit(1);
});
