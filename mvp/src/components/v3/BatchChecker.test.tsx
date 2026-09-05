import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchChecker } from "./BatchChecker";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BatchChecker", () => {
  it("旧 faceVerdict 走同一显示归一化，不把只能信一部分原样打出来", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              claim: "某药能治失眠，而且已经获批。",
              verdictType: "mixed_misleading",
              faceVerdict: "只能信一部分",
              conclusion: "前半有出处。",
            },
            {
              claim: "文科教育正在失去意义",
              verdictType: "unverified",
              faceVerdict: "立场型 / 不适用真/假判断",
              conclusion: "这是立场。",
            },
          ],
        }),
      })),
    );

    render(<BatchChecker initialText={"某药能治失眠，而且已经获批。\n文科教育正在失去意义"} />);
    fireEvent.click(screen.getByRole("button", { name: /逐条核查这 2 条/ }));

    await waitFor(() => {
      expect(screen.getByText("有真有假")).toBeInTheDocument();
    });
    expect(screen.getByText("立场型 / 不适用真/假判断")).toBeInTheDocument();
    expect(screen.queryByText("只能信一部分")).not.toBeInTheDocument();
    expect(screen.queryByText(/mixed misleading/i)).not.toBeInTheDocument();
  });
});
