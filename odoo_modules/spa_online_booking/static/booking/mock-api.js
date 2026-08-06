/**
 * Mock backend. Same response shapes as the real Odoo endpoints in
 * controllers/main.py, so switching to the real API later is a one-line
 * change in script.js (set USE_MOCK = false).
 */
window.MOCK_API = (() => {
  const services = [
    { id: 1, name: 'Aromatherapy Massage', duration_minutes: 60, price: '₹2,500', image_url: null },
    { id: 2, name: 'Swedish Massage', duration_minutes: 60, price: '₹2,500', image_url: null },
    { id: 3, name: 'Facial Treatment', duration_minutes: 45, price: '₹2,000', image_url: null },
    { id: 4, name: 'Hair Spa', duration_minutes: 50, price: '₹1,800', image_url: null },
    { id: 5, name: 'Body Scrub', duration_minutes: 40, price: '₹1,900', image_url: null },
    { id: 6, name: 'Manicure & Pedicure', duration_minutes: 55, price: '₹1,600', image_url: null },
  ];

  const questions = [
    { id: 1, text: 'Are you pregnant?', type: 'boolean', service_ids: [1, 2] },
    { id: 2, text: 'Do you have any skin allergies?', type: 'boolean', service_ids: [3, 5] },
    { id: 3, text: 'Any recent surgeries or injuries?', type: 'boolean', service_ids: [1, 2, 3, 4, 5, 6] },
    { id: 4, text: 'Any areas we should avoid or focus on?', type: 'text', service_ids: [1, 2] },
  ];

  const bookedSlots = ['11:00', '14:00']; // pretend these are already taken

  let submittedBookings = [];

  const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  return {
    async getSession(token) {
      await delay();
      if (!token) throw { status: 400, data: { error: 'missing_token' } };
      if (token === 'expired') throw { status: 410, data: { error: 'expired' } };
      return {
        token, whatsapp_number: '+91 98765 43210', state: 'pending',
        min_booking_date: new Date().toISOString().slice(0, 10),
        max_booking_date: null,
      };
    },

    async getServices() {
      await delay();
      return { services };
    },

    async getQuestions(serviceIds) {
      await delay();
      const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
      // union across the selected services, deduped by question id
      const filtered = questions.filter(q => q.service_ids.some(sid => ids.includes(sid)));
      return {
        questions: filtered.map(({ id, text, type }) => ({ id, text, type, required: true, options: [] })),
        // Stands in for the therapy's disclaimer so the page after the
        // questions can be exercised without a server. Blank the body to
        // check the skip path.
        disclaimer: {
          title: 'Disclaimer',
          body: 'Please read this before your session. Tell your therapist about any injury, '
              + 'illness or medication. Stop and say so if anything hurts.',
          style: 'font-weight: 400; font-style: italic',
        },
      };
    },

    async getAvailability(serviceIds, date) {
      await delay();
      const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
      // Taken times are still offered - they become waiting-list entries -
      // so the mock lists them all and flags the busy ones, like the server.
      const slots = [];
      const waitlist = [];
      for (let h = 9; h < 18; h++) {
        const label = `${String(h).padStart(2, '0')}:00`;
        slots.push(label);
        if (bookedSlots.includes(label)) waitlist.push(label);
      }
      return { date, service_ids: ids, slots, waitlist };
    },

    async submitBooking(payload) {
      await delay(500);
      const id = submittedBookings.length + 1;
      submittedBookings.push({ id, ...payload });
      console.log('[mock] booking submitted:', payload);
      return { success: true, booking_id: id };
    },
  };
})();
