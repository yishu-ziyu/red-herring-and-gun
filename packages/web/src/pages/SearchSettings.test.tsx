import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_BYO, SEARCH_INCLUDED, SEARCH_RECHARGE, SEARCH_SAVE, SEARCH_SAVED } from "../lib/copy.js";
import { loadSearchKeys } from "../lib/searchKeys.js";
import { SearchSettings } from "./SearchSettings.js";

const listSearchProviders = vi.fn();

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    listSearchProviders: () => listSearchProviders(),
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

beforeEach(() => {
  listSearchProviders.mockResolvedValue([
    {
      id: "any_search",
      label: "AnySearch",
      billing: "included",
      configured: true,
      hint: "已预置",
    },
    {
      id: "tavily_search",
      label: "Tavily",
      billing: "byo",
      configured: false,
      hint: "贴密钥",
      signupUrl: "https://app.tavily.com/",
      rechargeUrl: "https://app.tavily.com/",
    },
  ]);
});

describe("SearchSettings", () => {
  it("分组预置与收费源，收费源有充值链接", async () => {
    render(<SearchSettings onBack={() => undefined} />);
    expect(await screen.findByText(SEARCH_INCLUDED)).toBeTruthy();
    expect(screen.getByText("AnySearch")).toBeTruthy();
    expect(screen.getByText(SEARCH_BYO)).toBeTruthy();
    const recharge = screen.getByText(SEARCH_RECHARGE) as HTMLAnchorElement;
    expect(recharge.href).toBe("https://app.tavily.com/");
  });

  it("保存后密钥进 localStorage", async () => {
    render(<SearchSettings onBack={() => undefined} />);
    const input = await screen.findByPlaceholderText("把密钥贴在这里");
    fireEvent.change(input, { target: { value: "tvly-user" } });
    fireEvent.click(screen.getByRole("button", { name: SEARCH_SAVE }));
    await waitFor(() => {
      expect(screen.getByText(SEARCH_SAVED)).toBeTruthy();
    });
    expect(loadSearchKeys()).toEqual({ tavily_search: "tvly-user" });
  });
});
