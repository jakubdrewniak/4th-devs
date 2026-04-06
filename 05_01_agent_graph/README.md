src/
├── domain.ts        91 lines  — entity types
├── store.ts         59 lines  — generic file store
├── log.ts           91 lines  — colored terminal logger
├── llm.ts          138 lines  — OpenAI Responses API client
├── runtime.ts      113 lines  — Runtime context + entity helpers
├── tools.ts        390 lines  — tool definitions, actor configs, executeToolCall, artifact I/O
├── scheduler.ts    292 lines  — graph queries, context builder, actor loop, processSession
└── index.ts        152 lines  — demo scenario