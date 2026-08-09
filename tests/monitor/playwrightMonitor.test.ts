import { describe, expect, it } from "vitest";
import {
  browserLaunchArgs,
  isLikelyChatDetailRect,
  isUnresolvedDouyinShareCard,
  selectBestDouyinTitleForCurrentVideo,
  selectDouyinAwemeDetailTitle,
  selectDouyinVideoTitle,
  selectShareCoverImage,
  snapshotsFromDomModels,
} from "../../src/monitor/playwrightMonitor.js";

describe("browserLaunchArgs", () => {
  it("minimizes headed offscreen Chromium windows", () => {
    expect(browserLaunchArgs({ headless: false, offscreen: true })).toEqual(
      expect.arrayContaining(["--window-position=-32000,-32000", "--window-size=900,700", "--start-minimized"]),
    );
  });

  it("does not add window flags in real headless mode", () => {
    expect(browserLaunchArgs({ headless: true, offscreen: true })).not.toContain("--start-minimized");
  });
});

describe("snapshotsFromDomModels", () => {
  it("normalizes DOM models into message snapshots", () => {
    const snapshots = snapshotsFromDomModels([
      {
        html: '<a href="https://www.douyin.com/video/731">视频</a><img src="cover.jpg">',
        text: "视频",
        links: ["https://www.douyin.com/video/731"],
        images: ["cover.jpg"],
        timestamp: "2026-07-03T10:00:00.000Z",
      },
    ]);

    expect(snapshots).toEqual([
      {
        snapshotId: expect.stringMatching(/^dom:/),
        html: '<a href="https://www.douyin.com/video/731">视频</a><img src="cover.jpg">',
        text: "视频",
        links: ["https://www.douyin.com/video/731"],
        images: ["cover.jpg"],
        timestamp: "2026-07-03T10:00:00.000Z",
      },
    ]);
  });
});

describe("selectShareCoverImage", () => {
  it("prefers Douyin cover images over avatars", () => {
    const cover = selectShareCoverImage([
      "https://p11.douyinpic.com/aweme/100x100/aweme-avatar/example.jpeg",
      "https://p3-pc-sign.douyinpic.com/image-cut-tos-priv/example.jpeg?s=PackSourceEnum_AWEME_DETAIL",
    ]);

    expect(cover).toContain("image-cut-tos-priv");
  });
});

describe("isLikelyChatDetailRect", () => {
  it("keeps visible right-side chat detail content only", () => {
    expect(isLikelyChatDetailRect({ left: 900, width: 168, height: 224 }, 1280)).toBe(true);
    expect(isLikelyChatDetailRect({ left: 180, width: 320, height: 180 }, 1280)).toBe(false);
    expect(isLikelyChatDetailRect({ left: 900, width: 0, height: 224 }, 1280)).toBe(false);
  });
});

describe("isUnresolvedDouyinShareCard", () => {
  it("detects share cards that still need a Douyin URL", () => {
    expect(
      isUnresolvedDouyinShareCard({
        snapshotId: "s1",
        text: "作者",
        html: '<div class="MessageItemShareAwemecontainer"></div>',
        links: [],
        images: [],
      }),
    ).toBe(true);

    expect(
      isUnresolvedDouyinShareCard({
        snapshotId: "s2",
        text: "作者",
        html: '<div class="MessageItemShareAwemecontainer"></div>',
        links: ["https://www.douyin.com/jingxuan?modal_id=765"],
        images: [],
      }),
    ).toBe(false);
  });
});

describe("selectDouyinVideoTitle", () => {
  it("chooses the real video title over author and controls", () => {
    expect(
      selectDouyinVideoTitle(
        [
          "示例作者",
          "关注",
          "评论",
          "分享",
          "00:12",
          "如何用 AI 做自动化知识库 #AI #效率工具",
          "1.2万",
        ],
        "示例作者",
      ),
    ).toBe("如何用 AI 做自动化知识库 #AI #效率工具");
  });

  it("removes Douyin modal counters and trailing account metadata", () => {
    expect(
      selectDouyinVideoTitle([
        "13:16 10.5万 你的人生，不该只发生在一个城市 示例人物在异乡实现了目标。 #人生选择 @示例官方账号 @示例账号 · 4月12日",
      ]),
    ).toBe("你的人生，不该只发生在一个城市 示例人物在异乡实现了目标。 #人生选择");
  });

  it("uses the modal content below author as title", () => {
    expect(
      selectDouyinVideoTitle(
        [
          "@示例作者 · 1天前",
          "键盘消失转场效果教学",
          "#剪辑教程 #创意拍摄 #vlog开场片头怎么制作 #转场",
        ],
        "示例作者",
      ),
    ).toBe("键盘消失转场效果教学 #剪辑教程 #创意拍摄 #vlog开场片头怎么制作 #转场");
  });

  it("prefers the detail panel over longer recommendation text", () => {
    expect(
      selectDouyinVideoTitle(
        [
          '详情\nTA的作品\n评论\n问AI\n相关推荐\n@示例创作者 · 4小时前\n爆款声音设计作品拆解 油管百万播放的创作方法论 素材引用：\n示例素材\n音乐来源：\n示例音乐\n#声音设计 #剪辑配乐 #视频制作',
          "AI赢下所有游戏，但游戏可能不是用来赢的 美国赢了挑战大多数战役，最终输军一有限游戏玩家赢每一场，却输整盘；AI将赢下所有有限游戏；想赢它，唯一出路是成为无限游戏玩家",
        ],
        "示例创作者",
      ),
    ).toBe(
      "爆款声音设计作品拆解 油管百万播放的创作方法论 素材引用： 示例素材 音乐来源： 示例音乐 #声音设计 #剪辑配乐 #视频制作",
    );
  });

  it("keeps full modal content excluding author information", () => {
    expect(
      selectDouyinVideoTitle([
        "MacBook Pro 统一内存应该怎么选？ 这期视频专门讲清楚 MacBook Pro 最容易买错、也最难后悔补救的配置：统一内存。很多人买 MacBook Pro 时只盯着芯片，却忽略了内存对未来三到五年工作流的影响。 #macbookpro #macbookpro选购",
      ]),
    ).toBe(
      "MacBook Pro 统一内存应该怎么选？ 这期视频专门讲清楚 MacBook Pro 最容易买错、也最难后悔补救的配置：统一内存。很多人买 MacBook Pro 时只盯着芯片，却忽略了内存对未来三到五年工作流的影响。 #macbookpro #macbookpro选购",
    );
  });

  it("uses caption text with hashtags even without the detail tab chrome", () => {
    expect(
      selectDouyinVideoTitle([
        "Ai时代，如何选专业！ 作为经历过这场Ai变革的毕业生！ 给应届生们分享下我的经验！\n#新兴专业主理人 #抖音精选高考应援联盟\n#AI时代怎么选专业 #欢迎来到我的专业\n#AI新星计划",
      ]),
    ).toBe(
      "Ai时代，如何选专业！ 作为经历过这场Ai变革的毕业生！ 给应届生们分享下我的经验！ #新兴专业主理人 #抖音精选高考应援联盟 #AI时代怎么选专业 #欢迎来到我的专业 #AI新星计划",
    );
  });

  it("removes collapsed-caption chrome from title candidates", () => {
    expect(
      selectDouyinVideoTitle([
        "第6集：VibeCoding大赏 | 我做了一个PPT Skill 这可能会让 PPT 真正进入 AI 时代。 skill 名称是「dashiAI-ppt-skill」。 历时两个月，我… 展开 版本过低，升级后可展示全部信息",
      ]),
    ).toBe("第6集：VibeCoding大赏 | 我做了一个PPT Skill 这可能会让 PPT 真正进入 AI 时代。 skill 名称是「dashiAI-ppt-skill」。 历时两个月，我");
  });

  it("removes collection and overlay controls from expanded captions", () => {
    const expected =
      "第3集：为什么你拍的视频，一看就不专业？ 示例创作者的口播场景导演Skill #视频制作 #Skill";

    expect(
      selectDouyinVideoTitle(
        [
          [
            "@示例创作者 · 16小时前",
            "第3集：为什么你拍的视频，一看就不专业？",
            "示例创作者的口播场景导演Skill #视频制作 #Skill",
            "合集 · Codex & ClaudeCode实战 | 已是最新集",
            "识别画面",
            "个人观点，仅供参考",
          ].join("\n"),
        ],
        "示例创作者",
      ),
    ).toBe(expected);

    expect(
      selectDouyinVideoTitle(
        [
          `${expected} 展开 合集 · Codex & ClaudeCode实战 | 已是最新集 识别画面 个人观点，仅供参考`,
        ],
        "示例创作者",
      ),
    ).toBe(expected);
  });

  it("removes author badge and publish time without dropping a flattened caption", () => {
    const expected =
      "AI进阶用法指南，五分钟教会你！ 提示词其实没那么难！ #我的第一个豆包手搓skill #我之前简直就是在乱用豆包 #人类对豆包的开发不足";

    expect(
      selectDouyinVideoTitle(
        [
          [
            "@认证作者 抖音认证 · 19小时前",
            "AI进阶用法指南，五分钟教会你！",
            "提示词其实没那么难！ #我的第一个豆包手搓skill #我之前简直就是在乱用豆包 #人类对豆包的开发不足",
          ].join("\n"),
        ],
        "认证作者",
      ),
    ).toBe(expected);

    expect(
      selectDouyinVideoTitle(
        [`@认证作者 抖音认证 · 19小时前 ${expected}`],
        "认证作者",
      ),
    ).toBe(expected);
  });

  it("removes account menu chrome around a video caption", () => {
    expect(
      selectDouyinVideoTitle([
        "SampleUser关注135粉丝788我的喜欢42示例视频标题。 #AI工具 #自动化示例另一条视频文案。 #vlog #生活记录我的收藏29观看历史30天内稍后再看1我的作品8我的预约我的订单退出登录",
      ]),
    ).toBe(
      "示例视频标题。 #AI工具 #自动化示例另一条视频文案。 #vlog #生活记录",
    );
  });

  it("rejects private-message noise as a video title", () => {
    expect(
      selectDouyinVideoTitle(
        [
          [
            "示例用户 会话甲 刚刚 视频无法查看",
            "39分钟前 会话乙 昨天 22:27",
            "示例作者 昨天 21:32 你撤回了一条消息",
            "昨天 21:20 会话丙 昨天 11:48 你撤回了一条消息",
          ].join("\n"),
        ],
        "会话甲",
      ),
    ).toBeUndefined();
  });

  it("rejects generic Douyin landing metadata as a video title", () => {
    expect(
      selectDouyinVideoTitle([
        "海量优质视频内容，涵盖游戏、二次元、美食、音乐、知识、体育运动、旅行、生活等各类题材，系列合集内容连续看，有用又有趣，无论是休闲解压、消遣下饭，还是发现爱好、获取知识，你想要的好内容，都在抖音精选。",
      ]),
    ).toBeUndefined();
  });
});

describe("selectDouyinAwemeDetailTitle", () => {
  it("uses the desc for the requested aweme id", () => {
    expect(
      selectDouyinAwemeDetailTitle(
        {
          data: {
            aweme_detail: {
              aweme_id: "7650000000000000003",
              desc: "codex自动化剪辑，上一条就是Codex剪的 #codex #AI新星计划 #Agent #GPT #AI剪辑",
              author: { nickname: "示例作者" },
            },
          },
        },
        "7650000000000000003",
      ),
    ).toBe("codex自动化剪辑，上一条就是Codex剪的 #codex #AI新星计划 #Agent #GPT #AI剪辑");
  });

  it("does not return another aweme detail when ids do not match", () => {
    expect(
      selectDouyinAwemeDetailTitle(
        {
          aweme_detail: {
            aweme_id: "7650000000000000000",
            desc: "示例视频标题。 #AI工具",
          },
        },
        "7650000000000000003",
      ),
    ).toBeUndefined();
  });
});

describe("selectBestDouyinTitleForCurrentVideo", () => {
  it("prefers the full detail-panel title when the api title is truncated", () => {
    const apiTitle =
      "个设计，解锁你 80% 的 AI用法！ okay，这是我最近做的一期非常详细的进阶指南吧！ 如果你还困扰在如何写好一个 Prompt，怎么让他输出一个更好的结果的话，那接下来……版本过低，升级后可展示全部信息";
    const domTitle =
      "5 个设计，解锁你 80% 的 AI 用法！ okay，这是我最近做的一期非常详细的进阶指南吧！ 如果你还困扰在如何写好一个 Prompt，怎么让他输出一个更好的结果的话，那接下来这五个工程式的设计一定能够很大程度提升你的 AI 能力的！ #抖音前沿科技首发计划 #ai新星计划 @抖音科技";

    expect(selectBestDouyinTitleForCurrentVideo(apiTitle, domTitle)).toBe(domTitle);
  });

  it("keeps the api title when the visible DOM still belongs to another video", () => {
    const apiTitle = "codex自动化剪辑，上一条就是Codex剪的 #codex #AI新星计划 #Agent #GPT #AI剪辑";
    const staleDomTitle = "另一条视频的示例标题。 #AI工具";

    expect(selectBestDouyinTitleForCurrentVideo(apiTitle, staleDomTitle)).toBe(apiTitle);
  });
});
