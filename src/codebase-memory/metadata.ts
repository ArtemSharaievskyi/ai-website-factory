import { z } from "zod";
export const CodebaseMemoryMetadataSchema=z.object({currentIndexId:z.string().min(1),manifestChecksum:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["NOT_INDEXED","INDEXING","READY","STALE","FAILED"]),updatedAt:z.string().datetime(),adapterVersion:z.string().min(1)}).strict();
export type CodebaseMemoryMetadata=z.infer<typeof CodebaseMemoryMetadataSchema>;
export const CODEBASE_MEMORY_METADATA_FILENAME="codebase-memory.json";
