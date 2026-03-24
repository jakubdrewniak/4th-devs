export interface KnowledgeAccess {
  tool: string;
  account: string;
  query?: string;
  returned: { id: string; title: string; scope: 'shared' | string }[];
  blocked: { id: string; title: string; owner: string }[];
}

export const knowledgeAccessLog: KnowledgeAccess[] = [];
