import { describe, expect, it } from "vitest";
import { collapseNarrativeAtoms, ensureLeapAtoms, extractLeapAtoms } from "./textbookAtoms.js";

const WALL =
  "长城，又称万里长城，是中国古代规模最为宏大的军事防御工程。在流传甚广的说法里，长城是唯一一座能从太空中用肉眼看到的人造建筑，这句话曾被写进无数教科书与科普读物。根据国家文物局公布的资源调查结果，长城的总长度超过两万公里，蜿蜒于中国北方的群山之间。它最早始建于春秋战国时期，由各诸侯国为抵御外敌而分段修筑，后来才被陆续连接成一体。在建造工艺上，有研究指出，明代工匠曾在砂浆中掺入糯米浆，让城砖之间的黏合变得格外牢固。而在民间，孟姜女哭长城的故事流传千年，据说这段悲剧就发生在秦始皇征发民夫的年代。今天的长城早已是世界文化遗产。有统计称，长城每年吸引超过一千万名游客慕名而来，稳居中国最热门旅游目的地之列。";

const SENTENCE_ATOMS = [
  "长城，又称万里长城，是中国古代规模最为宏大的军事防御工程",
  "长城是唯一一座能从太空中用肉眼看到的人造建筑",
  "这句话曾被写进无数教科书与科普读物",
  "长城的总长度超过两万公里",
  "蜿蜒于中国北方的群山之间",
  "它最早始建于春秋战国时期",
  "由各诸侯国为抵御外敌而分段修筑",
  "后来才被陆续连接成一体",
  "明代工匠曾在砂浆中掺入糯米浆",
  "孟姜女哭长城的故事流传千年",
  "今天的长城早已是世界文化遗产",
  "长城每年吸引超过一千万名游客慕名而来",
];

/** 走查现场：模型转述成 9 条，不是原句切片。 */
const WALKTHROUGH_ATOMS = [
  "「长城能从太空看到」这句话曾被写进无数教科书与科普读物",
  "长城的总长度超过两万公里",
  "长城最早始建于春秋战国时期",
  "由各诸侯国分段修筑后连接成一体",
  "明代工匠曾在砂浆中掺入糯米浆",
  "孟姜女哭长城的故事流传千年",
  "孟姜女哭长城发生在秦始皇征发民夫的年代",
  "长城是世界文化遗产",
  "长城每年吸引超过一千万名游客",
];

describe("collapseNarrativeAtoms", () => {
  it("课文按句切开时只留可核查断言，不超过 4 条，不单列写进教科书", () => {
    const out = collapseNarrativeAtoms(WALL, SENTENCE_ATOMS);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.some((atom) => atom.includes("军事防御") || atom.includes("肉眼") || atom.includes("太空"))).toBe(true);
    expect(out.some((atom) => atom.includes("肉眼") || atom.includes("太空"))).toBe(true);
    expect(out.some((atom) => atom.includes("世界文化") || atom.includes("超过两万"))).toBe(true);
    expect(out.some((atom) => atom.includes("蜿蜒于"))).toBe(false);
    expect(out.some((atom) => atom.includes("这句话曾被写进") || atom.includes("写进无数教科书"))).toBe(false);
  });

  it("走查那种转述 9 条：抽回 ≤4，太空可见留下，写进教科书不单独成条", () => {
    const out = collapseNarrativeAtoms(WALL, WALKTHROUGH_ATOMS);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.some((atom) => atom.includes("太空") || atom.includes("肉眼"))).toBe(true);
    expect(out.every((atom) => !/写进.{0,12}教科书/.test(atom))).toBe(true);
  });

  it("短谣少条不收", () => {
    const atoms = ["隔夜菜不能吃", "放一晚上亚硝酸盐会升高", "会致癌"];
    expect(collapseNarrativeAtoms("隔夜菜不能吃，放一晚上亚硝酸盐会升高致癌。", atoms)).toEqual(atoms);
  });

  it("用户真在问教科书时不删那条", () => {
    const claim = "这句话被写进教科书了吗？";
    const atoms = ["这句话曾被写进无数教科书"];
    expect(collapseNarrativeAtoms(claim, atoms)).toEqual(atoms);
  });
});

const SALT =
  "国家卫健委建议成人每天盐不超过 5 克，中国人平均能吃到 10 克。高钠是高血压最主要的危险因素。2021 年《新英格兰医学杂志》在中国农村做过大规模试验，用含钾的低钠盐替换普通盐，中风和死亡都明显下降。所以高血压全是吃盐造成的，全家换成低钠盐就能预防中风，肾功能不好的老人也完全适用。";

const SALT_BACKGROUND = [
  "国家卫健委建议成人每天盐摄入量不超过5克",
  "中国人平均每天盐摄入量约为10克",
  "高钠摄入是高血压最主要的危险因素",
  "2021年《新英格兰医学杂志》在中国农村开展过一项大规模低钠盐替代试验",
];

describe("ensureLeapAtoms", () => {
  it("抽出所以之后的三截跳跃", () => {
    const leaps = extractLeapAtoms(SALT);
    expect(leaps.some((item) => item.startsWith("所以") && item.includes("全是吃盐"))).toBe(true);
    expect(leaps.some((item) => item.includes("全是吃盐"))).toBe(true);
    expect(leaps.some((item) => item.includes("预防中风"))).toBe(true);
    expect(leaps.some((item) => item.includes("完全适用") || item.includes("肾功能"))).toBe(true);
  });

  it("只有背景四条时，仍把三截跳跃补进待查清单，并排在前面", () => {
    const out = ensureLeapAtoms(SALT, SALT_BACKGROUND);
    expect(out.some((item) => item.includes("全是吃盐"))).toBe(true);
    expect(out.some((item) => item.includes("预防中风"))).toBe(true);
    expect(out.some((item) => item.includes("完全适用") || item.includes("肾功能"))).toBe(true);
    expect(out.findIndex((item) => item.includes("全是吃盐"))).toBeLessThan(
      out.findIndex((item) => item.includes("5克") || item.includes("5 克")),
    );
  });

  it("没有所以/因此时原样返回", () => {
    expect(ensureLeapAtoms("隔夜菜会致癌", ["隔夜菜会致癌"])).toEqual(["隔夜菜会致癌"]);
  });

  it("已有带主语的完整主张时，不再制造无主语的所以残句", () => {
    const claim = "气泡水是碱性的，所以可以中和酸。因此，当胃有些不舒服的时候，喝苏打水就够了。";
    const atoms = ["气泡水是碱性的", "气泡水可以中和酸", "当胃有些不舒服的时候，喝苏打水就够了"];
    const out = ensureLeapAtoms(claim, atoms);
    expect(out).toContain("气泡水可以中和酸");
    expect(out).not.toContain("所以可以中和酸");
    expect(out.filter((item) => item.includes("可以中和酸"))).toHaveLength(1);
  });
});
