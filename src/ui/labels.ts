/** Plain-language text for outbox reasons and activity events */

const REASONS: Record<string, string> = {
  existing_chat: "You've already chatted with them",
  last_message_is_mine: "Your message was the last one",
  composer_not_empty: "You had a message typed in that chat",
  chat_not_found: "Couldn't find the chat",
  chat_row_not_found: "Couldn't find the chat in the list",
  chat_did_not_open: "Clicked the chat but it didn't open",
  chat_not_confirmed: "A chat opened but it couldn't be confirmed as theirs",
  no_messages_found: "Couldn't read the chat",
  direction_unknown: "Couldn't tell who sent the messages in the chat",
  could_not_type: "Couldn't type the message",
  send_button_not_found: "Couldn't find the send button",
  not_confirmed: "Couldn't confirm it was sent; check the chat",
  manual_reply: "You replied yourself",
  dismissed: "Dismissed",
  paused_after_manual_reply: "You replied yourself",
  development_install_test_numbers_only: "Development install: test numbers only",
  auto_send_turned_off: "Auto-send was turned off",
  never_messaged_us: "They haven't messaged you",
  handed_off: "Handed off to you",
  opted_out: "They opted out",
  already_answered: "The chat was already answered",
  chat_moved_on: "They wrote again, so a newer reply replaces it",
  superseded: "Replaced by a reply to their newer message",
};

export const STAGES: Record<string, string> = {
  new_lead: "New lead",
  awaiting_cv: "Awaiting CV",
  cv_received: "CV received",
  in_progress: "In progress",
  preview_sent: "Preview sent",
  pending_payment: "Pending payment",
  paid: "Paid",
  delivered: "Delivered",
  follow_up: "Follow up",
  cancelled: "Cancelled",
};

export const PRODUCTS: Record<string, string> = {
  cv_cover_letter: "CV + Cover Letter",
  cv_cover_letter_linkedin: "CV + Cover Letter + LinkedIn",
};

export const INTENTS: Record<string, string> = {
  greeting: "Greeting",
  pricing_question: "Asking about prices",
  ready_to_order: "Ready to order",
  sent_cv: "Sent their CV",
  target_role_info: "Job they're applying for",
  proof_of_payment: "Proof of payment",
  process_question: "Question about the process",
  revision_request: "Wants changes",
  complaint: "Complaint",
  refund_request: "Refund request",
  payment_dispute: "Payment dispute",
  unrelated: "Not about CVs",
  other: "Other",
};

/** What the safety filter took out of a draft */
const POLICY_FLAGS: Record<string, string> = {
  price: "a price",
  bank_details: "bank details",
  payment_confirmation: "a payment confirmation",
  refund_promise: "a refund promise",
  ai_vendor: "an AI name",
  too_long: "the end (too long)",
  stage_not_allowed: "a stage change it may not make",
  no_pricing_message: "a pricing suggestion (no pricing message saved)",
  no_request_cv_message: "a CV request suggestion (no CV request message saved)",
  no_payment_details_message: "a payment details suggestion (no payment message saved)",
};

export function policyText(flags: string[]): string | null {
  if (flags.length === 0) return null;
  return `Removed: ${flags.map((flag) => POLICY_FLAGS[flag] ?? flag.replace(/_/g, " ")).join(", ")}.`;
}

export function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

const EVENTS: Record<string, string> = {
  pricing_queued: "Pricing waiting for approval",
  pricing_scheduled: "Pricing scheduled",
  pricing_sent: "Pricing sent",
  pricing_skipped: "Pricing skipped",
  send_failed: "Send failed",
  outbox_approved: "Approved",
  outbox_cancelled: "Cancelled",
  manual_reply_pause: "You replied: chat paused",
  order_stage_changed: "Order stage changed",
  order_product_set: "Product set",
  pop_received: "Proof of payment received",
  handoff_opened: "Handed to you",
  handoff_closed: "Handoff closed",
  draft_failed: "Draft failed",
  reply_scheduled: "Reply scheduled (automatic)",
  reply_queued: "Reply waiting for approval",
  reply_sent: "Reply sent",
  selector_failure: "WhatsApp Web changed",
  selector_recovered: "WhatsApp Web check passed",
  kill_switch_on: "Kill switch on",
  kill_switch_off: "Kill switch off",
  settings_updated: "Settings changed",
  install_created: "Token created",
  install_rotated: "Token rotated",
  install_revoked: "Token revoked",
};

export function eventText(type: string): string {
  return EVENTS[type] ?? type.replace(/_/g, " ");
}

/** "just now", "5 min ago", "2 h ago" */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}
