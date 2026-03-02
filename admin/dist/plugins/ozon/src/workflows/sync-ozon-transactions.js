export async function syncOzonTransactions(container, accountId, dateFrom, dateTo) {
    const ozonService = container.resolve("ozonService");
    const saleService = container.resolve("saleService");
    const account = await ozonService.retrieveOzonAccount(accountId);
    const now = new Date();
    const to = dateTo ? new Date(dateTo) : now;
    const from = dateFrom
        ? new Date(dateFrom)
        : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days back
    // Ozon Finance API allows max 1 month per request — split into monthly chunks
    const operations = [];
    let chunkStart = new Date(from);
    while (chunkStart < to) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setMonth(chunkEnd.getMonth() + 1);
        if (chunkEnd > to)
            chunkEnd.setTime(to.getTime());
        const chunk = await ozonService.fetchOzonFinanceTransactions({ client_id: account.client_id, api_key: account.api_key }, chunkStart, chunkEnd);
        operations.push(...chunk);
        chunkStart = new Date(chunkEnd);
    }
    // Group operations by posting_number
    const byPosting = {};
    const orphanTransactions = [];
    for (const op of operations) {
        const postingNumber = op.posting?.posting_number || "";
        const summary = {
            operation_id: op.operation_id,
            type: op.type || "",
            operation_type: op.operation_type || "",
            operation_type_name: op.operation_type_name || "",
            amount: op.amount || 0,
            accruals_for_sale: op.accruals_for_sale || 0,
            sale_commission: op.sale_commission || 0,
            date: op.operation_date || "",
            services: (op.services || []).map((s) => ({
                name: s.name || "",
                price: s.price || 0,
            })),
            items: (op.items || []).map((i) => ({
                name: i.name || "",
                sku: i.sku || 0,
            })),
        };
        if (!postingNumber) {
            orphanTransactions.push(summary);
            continue;
        }
        if (!byPosting[postingNumber])
            byPosting[postingNumber] = [];
        byPosting[postingNumber].push(summary);
    }
    let salesUpdated = 0;
    let transactionsLinked = 0;
    let postingsNotFound = 0;
    const unmatchedPostings = [];
    const unmatchedDetails = {};
    for (const [postingNumber, txs] of Object.entries(byPosting)) {
        // Try exact match first
        let existingSales = await saleService.listSales({
            channel: "ozon",
            channel_order_id: postingNumber,
        });
        // Finance API often returns posting numbers without the product suffix (-1, -2, etc.)
        // Try prefix match: channel_order_id LIKE 'postingNumber-%'
        if (existingSales.length === 0) {
            existingSales = await saleService.listSales({
                channel: "ozon",
                channel_order_id: { $like: `${postingNumber}-%` },
            });
        }
        if (existingSales.length === 0) {
            postingsNotFound++;
            unmatchedPostings.push(postingNumber);
            unmatchedDetails[postingNumber] = txs;
            continue;
        }
        // Sort transactions by date
        txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        for (const sale of existingSales) {
            const metadata = sale.metadata || {};
            const existingTxIds = new Set((metadata.ozon_transactions || []).map((t) => t.operation_id));
            // Merge new transactions (avoid duplicates)
            const newTxs = txs.filter((t) => !existingTxIds.has(t.operation_id));
            if (newTxs.length === 0)
                continue;
            metadata.ozon_transactions = [
                ...(metadata.ozon_transactions || []),
                ...newTxs,
            ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            // Check for return-related fees and add to fee_details if missing
            const existingFeeKeys = new Set((sale.fee_details || []).map((f) => f.key));
            const updatedFees = [...(sale.fee_details || [])];
            for (const tx of newTxs) {
                if (tx.type !== "returns")
                    continue;
                for (const svc of tx.services) {
                    const classified = classifyService(svc.name);
                    if (!existingFeeKeys.has(classified.key)) {
                        updatedFees.push({
                            key: classified.key,
                            label: classified.label,
                            amount: Math.abs(svc.price),
                        });
                        existingFeeKeys.add(classified.key);
                    }
                }
            }
            const updateData = { id: sale.id, metadata };
            if (updatedFees.length > (sale.fee_details || []).length) {
                updateData.fee_details = updatedFees;
            }
            await saleService.updateSales(updateData);
            salesUpdated++;
            transactionsLinked += newTxs.length;
        }
    }
    // Save unmatched and orphan transactions to FinanceTransaction
    const financeService = container.resolve("financeService");
    const existingFinance = await financeService.listFinanceTransactions({
        source: "ozon_api",
        transaction_date: { $gte: from, $lte: to },
    });
    const existingOpIds = new Set(existingFinance.map((f) => f.metadata?.operation_id).filter(Boolean));
    const allUnlinked = [];
    for (const [posting, txs] of Object.entries(unmatchedDetails)) {
        for (const tx of txs)
            allUnlinked.push({ tx, postingNumber: posting });
    }
    for (const tx of orphanTransactions)
        allUnlinked.push({ tx });
    let financeCreated = 0;
    for (const { tx, postingNumber } of allUnlinked) {
        if (existingOpIds.has(tx.operation_id))
            continue;
        const classified = classifyOzonTransaction(tx);
        await financeService.createFinanceTransactions({
            user_id: account.user_id || undefined,
            type: classified.type,
            direction: tx.amount < 0 ? "expense" : "income",
            amount: Math.abs(tx.amount),
            category: classified.category,
            description: tx.operation_type_name,
            transaction_date: new Date(tx.date),
            source: "ozon_api",
            metadata: {
                operation_id: tx.operation_id,
                ozon_account_id: account.id,
                posting_number: postingNumber || null,
                services: tx.services,
                items: tx.items,
            },
        });
        existingOpIds.add(tx.operation_id);
        financeCreated++;
    }
    return {
        sales_updated: salesUpdated,
        transactions_linked: transactionsLinked,
        total_operations: operations.length,
        postings_not_found: postingsNotFound,
        unmatched_postings: unmatchedPostings,
        orphan_transactions: orphanTransactions.length,
        finance_created: financeCreated,
    };
}
function classifyOzonTransaction(tx) {
    const name = tx.operation_type_name.toLowerCase();
    if (name.includes("кросс-докинг"))
        return { type: "fbo_services", category: "crossdocking" };
    if (name.includes("обработка товара в составе грузоместа"))
        return { type: "fbo_services", category: "cargo_processing" };
    if (name.includes("обработка сроков годности"))
        return { type: "fbo_services", category: "expiry_handling" };
    if (name.includes("бронирование места"))
        return { type: "fbo_services", category: "supply_booking" };
    if (name.includes("баллы за отзывы"))
        return { type: "marketing", category: "review_rewards" };
    if (name.includes("хранение"))
        return { type: "fbo_services", category: "storage" };
    return { type: "other", category: tx.operation_type || "unknown" };
}
function classifyService(serviceName) {
    const lower = serviceName.toLowerCase();
    if (lower.includes("returnafterdelivtocustomer") || lower.includes("returnflowtrans"))
        return { key: "reverse_logistics", label: "Обратная логистика" };
    if (lower.includes("returnflowlogistic"))
        return { key: "return_flow_logistics", label: "Логистика возврата" };
    if (lower.includes("returnprocessing") || lower.includes("returnnotdelivtocustomer"))
        return { key: "return_processing", label: "Обработка возврата" };
    if (lower.includes("returnpartgoodscustomer"))
        return { key: "return_processing_partial", label: "Обработка частичного возврата" };
    if (lower.includes("redistributionreturns"))
        return { key: "redistribution_returns", label: "Перераспределение возвратов" };
    if (lower.includes("fulfillment"))
        return { key: "fulfillment_return", label: "Обработка отправления (возврат)" };
    if (lower.includes("lastmile") || lower.includes("delivtocustomer"))
        return { key: "last_mile_return", label: "Последняя миля (возврат)" };
    if (lower.includes("directflow"))
        return { key: "direct_flow_return", label: "Приёмка (возврат)" };
    return { key: `return_fee_${lower.slice(0, 30)}`, label: serviceName };
}
//# sourceMappingURL=sync-ozon-transactions.js.map