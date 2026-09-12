/**
 * SPEC §12. Branches are never deleted — appointments reference them, and the
 * history has to keep making sense. `active: false` hides one from the pickers.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { branches } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import type { CreateBranchInput, ListBranchInput, UpdateBranchInput } from './branch.schema.ts';

type Branch = typeof branches.$inferSelect;

export const branchService = {
    async list(input: ListBranchInput = { includeInactive: false }): Promise<Branch[]> {
        const query = db.select().from(branches).orderBy(asc(branches.name));
        const rows = await query;
        return input.includeInactive ? rows : rows.filter((b) => b.active);
    },

    async byId(id: string): Promise<Branch> {
        const [row] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
        if (!row) throw AppError.notFound('branch');
        return row;
    },

    async create(input: CreateBranchInput): Promise<Branch> {
        const [row] = await db
            .insert(branches)
            .values({
                id: Bun.randomUUIDv7(),
                name: input.name,
                address: input.address ?? null,
            })
            .returning();

        if (!row) throw AppError.internal('branch insert returned nothing');
        return row;
    },

    async update({ id, ...patch }: UpdateBranchInput): Promise<Branch> {
        const [row] = await db.update(branches).set(patch).where(eq(branches.id, id)).returning();
        if (!row) throw AppError.notFound('branch');
        return row;
    },
};
