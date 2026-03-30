export interface MenuItem {
  label: string;
  path: string;
  children?: MenuItem[];
}

export interface Menu {
  title: string;
  base: string;
  items: MenuItem[];
}

export interface ComparisonProduct {
  name: string;
  url?: string;
  positioning?: string;
  pricing?: string;
  deployment?: string;
  integrations?: string[];
  key_features?: string[];
  strengths?: string[];
  risks?: string[];
  best_fit?: string;
}

export interface ComparisonData {
  products: ComparisonProduct[];
  criteria?: string[];
}

export interface PageSeo {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  keywords?: string[];
  noindex?: boolean;
}

export interface Page {
  slug: string;
  title: string;
  content: string;
  description?: string;
  date?: string;
  template?: string;
  comparison?: ComparisonData;
  seo?: PageSeo;
  published: boolean;
  listing?: boolean;
  listingPageSize?: number;
  raw: string;
}
