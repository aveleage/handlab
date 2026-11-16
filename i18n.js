// 画面の言語。文言は strings.js にあり、ここは「どの言語で出すか」と「画面への流し込み」だけを持つ。
import STRINGS from "./strings.js";

export const LANGS = { ja: "日本語", en: "English", zh: "简体中文", ko: "한국어" };
const HTML_LANG = { ja: "ja", en: "en", zh: "zh-Hans", ko: "ko" };
let lang = "en";

/** ブラウザの言語から選ぶ。対応していない言語なら英語。 */
export function detectLang() {
  for (const l of navigator.languages || [navigator.language || ""]) {
    const k = String(l).toLowerCase().slice(0, 2);
    if (LANGS[k]) return k;
  }
  return "en";
}

/** 言語を決める。want が空か、対応していなければブラウザの言語に合わせる。決まった言語を返す。 */
export function setLang(want = "") {
  lang = LANGS[want] ? want : detectLang();
  document.documentElement.lang = HTML_LANG[lang];
  return lang;
}

export const getLang = () => lang;

/** 文言を取り出す。{name} の形の穴は vars で埋める。その言語に無ければ英語、それも無ければキーそのもの。 */
export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/**
 * 画面に流し込む。
 *   data-t="キー"        文字として入れる
 *   data-t-html="キー"   HTML として入れる（リンクや <code> を含む文言用。文言は自分たちで書いたものだけ）
 *   data-t-title="キー"  title（マウスを乗せたときの説明）に入れる
 *   data-t-content="キー" content（meta タグ）に入れる
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll("[data-t-html]")) el.innerHTML = t(el.dataset.tHtml);
  for (const el of root.querySelectorAll("[data-t-title]")) el.title = t(el.dataset.tTitle);
  for (const el of root.querySelectorAll("[data-t-content]")) el.setAttribute("content", t(el.dataset.tContent));
}
