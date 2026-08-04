import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { SpaQuestionsDialog } from "@pos_spa_header/spa_questions_dialog";

patch(PosStore.prototype, {
    async addLineToCurrentOrder(vals, opts = {}, configure = true) {
        const line = await super.addLineToCurrentOrder(vals, opts, configure);
        // When a line is created by loading an existing spa booking, its answers
        // were already collected online — don't re-prompt the questions dialog.
        if (opts.skipSpaQuestions) {
            return line;
        }
        try {
            const tmplId = line && line.product_id && line.product_id.product_tmpl_id
                ? line.product_id.product_tmpl_id.id
                : null;
            if (tmplId && !line._spaAsked) {
                const questions = await this.data.call(
                    "product.template",
                    "get_pos_spa_questions",
                    [tmplId]
                );
                if (questions && questions.length) {
                    line._spaAsked = true;
                    const answers = await makeAwaitable(this.dialog, SpaQuestionsDialog, {
                        questions,
                    });
                    if (answers) {
                        line.setCustomerNote(answers);
                    }
                }
            }
        } catch (e) {
            console.warn("Spa questions: could not load/ask questions", e);
        }
        return line;
    },
});
