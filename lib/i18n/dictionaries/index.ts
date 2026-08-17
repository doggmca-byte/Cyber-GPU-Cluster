import en, { type TranslationDictionary } from "./en";
import uk from "./uk";
import ru from "./ru";
import ar from "./ar";
import id from "./id";
import es from "./es";
import kk from "./kk";
import tr from "./tr";
import type { LanguageCode } from "../languages";

export type { TranslationDictionary };

export const dictionaries: Record<LanguageCode, TranslationDictionary> = {
  en,
  uk,
  ru,
  ar,
  id,
  es,
  kk,
  tr,
};
