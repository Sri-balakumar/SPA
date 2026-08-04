import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";
import { NewQuestionDialog } from "@spa_online_booking/pos/new_question_dialog";

// Replace the plain "New Question" form dialog with the Stretch & Go branded one.
patch(Navbar.prototype, {
    onClickNewQuestion() {
        this.dialog.add(NewQuestionDialog, {
            orm: this.env.services.orm,
            companyId: this.pos.config.company_id?.id,
        });
    },
});
