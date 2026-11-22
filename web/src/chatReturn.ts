// "Open chat" links on other pages (Actions, After price, Kito, Receipts, Report, Attention, Products) jump to
// #chats/ids=<id>. Remember the page they came from, so the chat's back arrow returns there instead of
// dropping you on the Chats list.

let from: string | null = null;

export function startChatReturn() {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#chats/ids="]');
    if (!a) return;
    from = location.hash.startsWith("#chats") ? null : location.hash || "#dashboard";
  }, true);
}

/** The page to go back to (once), or null if the chat wasn't opened from another page. */
export function takeChatReturn(): string | null {
  const f = from;
  from = null;
  return f;
}
