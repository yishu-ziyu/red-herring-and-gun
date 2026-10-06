import { describe, expect, it } from "vitest";
import { extractPiyaoArticle, statementsFromTitle } from "./extract";

// Small hand-written snippets shaped like piyao.org.cn article pages.
function page(opts: { title: string; publisher: string; date: string; body: string }): string {
  return `<html><head><meta name="publishdate" content="${opts.date}"></head><body>
<div class="con_tit" data="datasource:x" datatype="content"><h2>
  ${opts.title}
</h2> <p>
  来源： ${opts.publisher}<span>时间：
  ${opts.date}</span></p></div>
<div class="con_txt" data="datasource:x" datatype="content"><div id="videoArea"><span style="display:none;">导航杂项</span></div>
<div id="detailContent">${opts.body}</div></div>
<div class="zrbj right">责任编辑： 张三</div>
<div class="btmbox"><div class="jbrk_box left"></div></div></body></html>`;
}

const SINGLE = page({
  title: "网传“四川绵阳越王楼将被拆除”？谣言！",
  publisher: "四川互联网举报辟谣平台、网信游仙",
  date: "2026-09-23",
  body:
    "<p>&emsp;&emsp;近日，有网民在社交平台发布帖文，并配发现场施工围挡视频，引发部分网民关注讨论。经游仙发展公司核实，网传内容不实。</p>" +
    '<p><img src="a.jpg"></p>' +
    "<p>&emsp;&emsp;经查，现场设置围挡，系实施越王楼周边人行通道提升改造工程。本次施工仅对越王楼广场区域的人行通道进行改造提升，不涉及越王楼主体建筑。</p>" +
    "<p>&emsp;&emsp;温馨提示：广大网民面对网络信息，务必仔细甄别信息来源，不信谣、不传谣。</p>",
});

const ROUNDUP = page({
  title: "涉西藏吉隆泥石流灾害传言、气象部门不敢预报40℃高温、没打HPV疫苗不能入学……这些都是谣言",
  publisher: "全国网络辟谣",
  date: "2026-09-04",
  body:
    "<p>&emsp;&emsp;2026年8月，网络谣言主要集中在自然灾害、民生政策等领域。</p>" +
    "<p>&emsp;&emsp;谣言：网传“某市学校要求学生必须接种HPV疫苗才能入学”。经卫健部门核实，该说法不实，国家没有此类规定。</p>" +
    "<p>&emsp;&emsp;网传“气象部门不敢预报40℃高温”。中国气象局回应称，预报按标准发布，该说法系谣言。</p>",
});

describe("statementsFromTitle", () => {
  it("takes the quoted claim after 网传 and drops the verdict", () => {
    expect(statementsFromTitle("网传“四川绵阳越王楼将被拆除”？谣言！")).toEqual(["四川绵阳越王楼将被拆除"]);
  });
  it("splits a question-title with a verdict tail", () => {
    expect(statementsFromTitle("哺乳期妈妈吃纯素可以提高母乳质量？谣言！")).toEqual(["哺乳期妈妈吃纯素可以提高母乳质量"]);
  });
  it("splits a roundup title into several statements without the verdict clause", () => {
    expect(statementsFromTitle("涉西藏吉隆泥石流灾害传言、气象部门不敢预报40℃高温、没打HPV疫苗不能入学……这些都是谣言")).toEqual([
      "涉西藏吉隆泥石流灾害传言",
      "气象部门不敢预报40℃高温",
      "没打HPV疫苗不能入学",
    ]);
  });
  it("reads the quoted claim in real title shapes seen on the site", () => {
    expect(statementsFromTitle("“上海化工园区发生大爆炸”不实（2026·09·24）")).toEqual(["上海化工园区发生大爆炸"]);
    expect(statementsFromTitle("广州地铁辟谣“嘉禾望岗站发生砍人事件”")).toEqual(["嘉禾望岗站发生砍人事件"]);
    expect(statementsFromTitle("晓真播报｜加油时油枪自动跳枪，是加油机在偷油？")).toEqual(["加油时油枪自动跳枪，是加油机在偷油"]);
    expect(statementsFromTitle("手足口病、诺如病毒，感染一次就不会再感染……是真是假？")).toEqual(["手足口病、诺如病毒，感染一次就不会再感染"]);
    expect(statementsFromTitle("安徽浮山地震？网民鲍某被罚！")).toEqual(["安徽浮山地震"]);
  });
  it("cleans verdict suffixes, commentary tails and question marks inside quotes", () => {
    expect(statementsFromTitle("网传青海高电压实验室试验会致癌系谣言")).toEqual(["青海高电压实验室试验会致癌"]);
    expect(statementsFromTitle("24小时不关空调，电费反而更低？网友热议！")).toEqual(["24小时不关空调，电费反而更低"]);
    expect(statementsFromTitle("大“申”说辟谣 | “气象台不报40℃？”这是真的吗？")).toEqual(["气象台不报40℃"]);
    expect(statementsFromTitle("天津静海施工井事故致4人遇难？假的！")).toEqual(["天津静海施工井事故致4人遇难"]);
  });
  it("handles 纯属谣言 / 是误传 suffixes, arrow tails and quoted slogans", () => {
    expect(statementsFromTitle("“云南文山12级台风致人伤亡”纯属谣言（2026·09·01）")).toEqual(["云南文山12级台风致人伤亡"]);
    expect(statementsFromTitle("国家疾控局权威回应：“没打HPV疫苗不能入学”是误传（2026·08·24）")).toEqual(["没打HPV疫苗不能入学"]);
    expect(statementsFromTitle("内涝积水蹚水没有风险？气象台不敢报40℃？2026年7月科学领域流言榜来了→")).toEqual(["内涝积水蹚水没有风险", "气象台不敢报40℃"]);
    expect(statementsFromTitle("晓真播报｜秋季过敏更猛？可以“以毒攻毒”？")).toEqual(["秋季过敏更猛", "可以“以毒攻毒”"]);
    expect(statementsFromTitle("“举报辟谣号”主题专列亮相济南地铁4号线")).toEqual([]);
  });
  it("ignores campaign headlines that only quote a slogan", () => {
    expect(statementsFromTitle("河北网络辟谣平台开展“e起护苗 共‘童’成长”网络举报辟谣宣传活动")).toEqual([]);
  });
  it("reads roundup titles whose verdict tail is 必须澄清 or which open with 假的！", () => {
    expect(statementsFromTitle("社保卡没有有效期、奶茶等于准毒品、微信好友数量过多会被封号……必须澄清！")).toEqual([
      "社保卡没有有效期",
      "奶茶等于准毒品",
      "微信好友数量过多会被封号",
    ]);
    expect(statementsFromTitle("假的！爆炸致多人死亡、浙江省山体滑坡、老人坐火车打折 中国互联网联合辟谣平台2025年6月辟谣榜")).toEqual([
      "爆炸致多人死亡",
      "浙江省山体滑坡",
      "老人坐火车打折",
    ]);
  });
  it("drops the monthly-chart tail after a separator", () => {
    expect(statementsFromTitle("成都幼儿园取消寒暑假？上百条毒蛇从广汉某养殖场出逃？｜6月熊猫捉谣月榜")).toEqual(["成都幼儿园取消寒暑假", "上百条毒蛇从广汉某养殖场出逃"]);
  });
  it("does not treat slogans that merely mention 谣言 or 辟谣 as claims", () => {
    expect(statementsFromTitle("汇民声、止谣言、护万家：江苏努力构建网络举报辟谣治理新格局")).toEqual([]);
    expect(statementsFromTitle("求真护企 实景探访 八师石河子市以现场击碎涉企谣言")).toEqual([]);
    expect(statementsFromTitle("《守护古蜀文脉 人人皆是辟谣侠》")).toEqual([]);
  });
  it("returns nothing for a headline that states no claim", () => {
    expect(statementsFromTitle("河南洛阳通报3起“清朗”系列专项行动典型案例")).toEqual([]);
  });
});

describe("extractPiyaoArticle", () => {
  it("extracts metadata, statement, verdict and verbatim key sentences from a single-story page", () => {
    const r = extractPiyaoArticle(SINGLE, "https://www.piyao.org.cn/20260923/0ebbb3e367e745059ab3bf04e2041329/c.html");
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("single");
    expect(r!.title).toBe("网传“四川绵阳越王楼将被拆除”？谣言！");
    expect(r!.publishDate).toBe("2026-09-23");
    expect(r!.originalPublisher).toBe("四川互联网举报辟谣平台、网信游仙");
    expect(r!.statements).toEqual(["四川绵阳越王楼将被拆除"]);
    expect(r!.verdict).toMatch(/不实|谣言/);
    expect(r!.keySentences.length).toBeGreaterThanOrEqual(2);
    expect(r!.keySentences.length).toBeLessThanOrEqual(5);
    for (const s of r!.keySentences) expect(r!.fullText).toContain(s);
    expect(r!.keySentences.join("")).toContain("不涉及越王楼主体建筑");
    expect(r!.keySentences.join("")).not.toContain("温馨提示");
    // full text is the article body only: no responsible-editor or nav text
    expect(r!.fullText).not.toContain("责任编辑");
    expect(r!.fullText).not.toContain("导航杂项");
    expect(r!.fullText).toContain("经查，现场设置围挡");
  });

  it("marks a multi-story roundup and yields several statements, each with its own items", () => {
    const r = extractPiyaoArticle(ROUNDUP, "https://www.piyao.org.cn/20260903/e5c130f3de8d46f1bb3a00c467f5dc11/c.html");
    expect(r!.kind).toBe("roundup");
    expect(r!.statements.length).toBeGreaterThanOrEqual(3);
    expect(r!.statements).toContain("没打HPV疫苗不能入学");
    expect(r!.statements).toContain("气象部门不敢预报40℃高温");
    expect(r!.statements).toContain("某市学校要求学生必须接种HPV疫苗才能入学");
    const hpv = r!.items.find((i) => i.statement === "某市学校要求学生必须接种HPV疫苗才能入学");
    expect(hpv!.keySentences.join("")).toContain("国家没有此类规定");
    // a body block does not borrow key sentences from another story
    expect(hpv!.keySentences.join("")).not.toContain("中国气象局");
  });

  it("treats a digest page with labelled sections as several stories and does not use its title for them", () => {
    const html = page({
      title: "编造“饮料企业创始人不喝自家品牌饮料”等涉企谣言的网民被拘留",
      publisher: "全国网络辟谣",
      date: "2026-09-22",
      body:
        "<p>辟 谣 “四川甘孜州街头出现棕熊”系AI伪造</p>" +
        "<p>详情：经道孚县公安局网安大队核实，道孚县并未发生棕熊上街事件，该图片系居民利用AI合成。</p>" +
        "<p>误 区 白砂糖比果葡糖浆更健康、果葡糖浆会阻断钙吸收？</p>" +
        "<p>真相：事实上，这类认知存在误区。所以“果葡糖浆会阻断钙吸收”是一种被夸大的说法。</p>" +
        "<p>通 报 吉林警方打掉一实施网暴违法犯罪团伙，98人落网</p>" +
        "<p>详情：经查，该团伙对多人实施辱骂。</p>",
    });
    const r = extractPiyaoArticle(html, "https://www.piyao.org.cn/20260922/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c.html");
    expect(r!.kind).toBe("roundup");
    const bear = r!.items.find((i) => i.statement === "四川甘孜州街头出现棕熊");
    expect(bear!.keySentences.join("")).toContain("并未发生棕熊上街事件");
    const sugar = r!.items.find((i) => i.statement === "白砂糖比果葡糖浆更健康");
    expect(sugar!.keySentences.join("")).toContain("被夸大的说法");
    expect(sugar!.keySentences.join("")).not.toContain("棕熊");
    // the 通报 section is news, not a rumor statement, and must not lend its text to the others
    expect(r!.statements.join("")).not.toContain("吉林");
    expect(sugar!.keySentences.join("")).not.toContain("辱骂");
    // the title claim has no matching section: kept, but with no borrowed sentences
    expect(r!.items.find((i) => i.statement === "饮料企业创始人不喝自家品牌饮料")!.keySentences).toEqual([]);
  });

  it("classifies a page with no claim as other and takes date from the meta tag when the header lacks it", () => {
    const html = page({ title: "河南洛阳通报3起“清朗”系列专项行动典型案例", publisher: "洛阳网信", date: "2026-09-29", body: "<p>洛阳通报三起案例。</p>" }).replace(
      /时间：\s*2026-09-29/,
      "",
    );
    const r = extractPiyaoArticle(html, "https://www.piyao.org.cn/20260929/70d68b05b70f4772ba356e8c53146235/c.html");
    expect(r!.kind).toBe("other");
    expect(r!.statements).toEqual([]);
    expect(r!.publishDate).toBe("2026-09-29");
  });

  it("keeps an image-only page (poster) as a record built from its title", () => {
    const html = page({ title: "“上海化工园区发生大爆炸”不实（2026·09·24）", publisher: "全国网络辟谣", date: "2026-09-24", body: '<p><img src="a.jpg"></p>' });
    const r = extractPiyaoArticle(html, "https://www.piyao.org.cn/20260924/001fb3ee04e14782a6ff9f96928af894/c.html");
    expect(r!.statements).toEqual(["上海化工园区发生大爆炸"]);
    expect(r!.fullText).toBe("");
  });

  it("returns null for html that is not an article page", () => {
    expect(extractPiyaoArticle("<html><body>404</body></html>", "https://www.piyao.org.cn/x/c.html")).toBeNull();
  });
});
