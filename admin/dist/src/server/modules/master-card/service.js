import { MasterCard } from "./entity.js";
export class MasterCardService {
    em;
    constructor(em) {
        this.em = em;
    }
    async list(filters = {}, options) {
        const where = this.buildWhere(filters);
        return this.em.find(MasterCard, where, {
            orderBy: options?.order || { created_at: "DESC" },
            offset: options?.skip,
            limit: options?.take,
        });
    }
    async retrieve(id) {
        return this.em.findOneOrFail(MasterCard, { id, deleted_at: null });
    }
    async create(data) {
        const card = this.em.create(MasterCard, { ...data, deleted_at: null });
        await this.em.persistAndFlush(card);
        return card;
    }
    async update(id, data) {
        const card = await this.retrieve(id);
        this.em.assign(card, data);
        await this.em.flush();
        return card;
    }
    async delete(id) {
        const card = await this.retrieve(id);
        card.deleted_at = new Date();
        await this.em.flush();
    }
    buildWhere(filters) {
        const where = { deleted_at: null };
        if (filters.user_id)
            where.user_id = filters.user_id;
        if (filters.status)
            where.status = filters.status;
        if (filters.$or)
            where.$or = filters.$or;
        return where;
    }
}
//# sourceMappingURL=service.js.map