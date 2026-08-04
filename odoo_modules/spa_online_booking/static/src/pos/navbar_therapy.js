import { patch } from "@web/core/utils/patch";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";

// "Book Therapy" button in the POS top bar: opens the full-screen booking page
// (Select Therapy -> packages -> questions -> customer details) inside the
// ProductScreen. The page itself adds the package to the order.
patch(Navbar.prototype, {
    onClickBookTherapy() {
        this.pos.showTherapyBooking = true;
        this.pos.navigate("ProductScreen");
    },
});
