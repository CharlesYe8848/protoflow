// products/deck/libs.js — 幻灯片用到的浏览器端依赖库。外部插件的库放 lib/<type>/（productLibDir），不跟别的产品抢名字。
import { packageFileFrom } from "protoflow/sdk";

const packageFile = packageFileFrom(import.meta.url);

export const DECK_LIBS = {
  "mermaid.min.js": packageFile("mermaid", "dist/mermaid.min.js"),
};
