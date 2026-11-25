// Facebook JS SDK: Login for Business (ads_read) and WhatsApp Embedded Signup (Coexistence).
declare global { interface Window { FB: any; fbAsyncInit: () => void } }

const APP_ID = import.meta.env.VITE_META_APP_ID as string;
const VERSION = (import.meta.env.VITE_META_GRAPH_VERSION as string) || "v25.0";

export const metaConfigured = () => !!APP_ID;

let sdk: Promise<any> | null = null;
export function loadSdk(): Promise<any> {
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    if (!APP_ID) return reject(new Error("Meta app ID is not set (VITE_META_APP_ID)."));
    window.fbAsyncInit = () => { window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: VERSION }); resolve(window.FB); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Could not load the Facebook SDK. Check your connection or ad blocker."));
    document.body.appendChild(s);
  });
  return sdk;
}

/** Facebook Login → short-lived user token that can read AND create ads (ads_read + ads_management + Page access for ad creatives) */
export async function loginForAds(): Promise<string> {
  const FB = await loadSdk();
  const configId = import.meta.env.VITE_META_ADS_CONFIG_ID;
  return new Promise((resolve, reject) => {
    FB.login((r: any) => {
      if (r.authResponse?.accessToken) resolve(r.authResponse.accessToken);
      else reject(new Error("Facebook login was cancelled."));
    }, configId
      ? { config_id: configId }
      : {
          scope: "ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,pages_manage_ads,instagram_basic,instagram_manage_insights",
          auth_type: "rerequest", // re-ask for permissions an earlier login didn't grant
        });
  });
}

/** Embedded Signup for WhatsApp Business app users (Coexistence). */
export async function embeddedSignup(): Promise<{ code: string; waba_id: string; phone_number_id: string }> {
  const FB = await loadSdk();
  const configId = import.meta.env.VITE_META_WA_CONFIG_ID;
  if (!configId) throw new Error("WhatsApp signup config ID is not set (VITE_META_WA_CONFIG_ID).");
  let session: { waba_id?: string; phone_number_id?: string } = {};
  let cancelled: string | null = null;
  const onMsg = (ev: MessageEvent) => {
    if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
    try {
      const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (/^FINISH/.test(d.event)) session = { waba_id: d.data?.waba_id, phone_number_id: d.data?.phone_number_id };
      else if (d.event === "CANCEL") cancelled = d.data?.current_step ?? "cancelled";
      else if (d.event === "ERROR") cancelled = d.data?.error_message ?? "error";
    } catch { /* not ours */ }
  };
  window.addEventListener("message", onMsg);
  try {
    const code: string = await new Promise((resolve, reject) => {
      FB.login((r: any) => {
        if (r.authResponse?.code) resolve(r.authResponse.code);
        else reject(new Error("WhatsApp connection was cancelled."));
      }, {
        config_id: configId, response_type: "code", override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3", version: "v4" },
      });
    });
    // session info message can arrive just after the login callback
    for (let i = 0; i < 20 && !session.phone_number_id && !cancelled; i++) await new Promise((r) => setTimeout(r, 250));
    if (!session.phone_number_id || !session.waba_id) throw new Error(cancelled ? `Signup stopped: ${cancelled}` : "Meta didn't return the WhatsApp number. Try again.");
    return { code, waba_id: session.waba_id, phone_number_id: session.phone_number_id };
  } finally {
    window.removeEventListener("message", onMsg);
  }
}
