# @redpine-ai/sdk

TypeScript client for the Redpine search API. Node 20+, ESM and CommonJS, typed end to end.

```bash
npm install @redpine-ai/sdk
```

```ts
import { Redpine, F } from '@redpine-ai/sdk';

const client = new Redpine(); // reads REDPINE_API_KEY
const r = await client.search('crispr delivery', {
  collections: ['corpus'],
  filters: F('issn').eq('1664-302X').or(F('issn').eq('1932-6203')),
});
```

Docs: https://docs.redpine.ai/docs/sdks
