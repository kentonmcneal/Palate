import { createSuggestionController } from "../use-suggestions";

jest.useFakeTimers();

type State = { suggestions: { name: string }[]; loading: boolean };

function harness(fetcher: (q: string) => Promise<{ name: string }[]>) {
  let state: State = { suggestions: [], loading: false };
  const ctrl = createSuggestionController<{ name: string }>({
    fetcher,
    onChange: (s) => { state = s as State; },
  });
  return { ctrl, get: () => state };
}

describe("type-ahead suggestions", () => {
  it("waits for a pause, so a typed word is one call and not eight", async () => {
    const fetcher = jest.fn().mockResolvedValue([{ name: "Chipotle" }]);
    const { ctrl } = harness(fetcher);
    for (const q of ["ch", "chi", "chip", "chipo"]) {
      ctrl.setQuery(q);
      jest.advanceTimersByTime(50);
    }
    expect(fetcher).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("chipo");
  });

  it("treats one letter as not a query — that is the whole table", () => {
    const fetcher = jest.fn().mockResolvedValue([]);
    const { ctrl } = harness(fetcher);
    ctrl.setQuery("c");
    jest.advanceTimersByTime(1000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discards an answer the user has already typed past", async () => {
    // The classic race: "chi" is slow, "chipotle" is fast, and the slow answer
    // lands last. Without the guard the list shows results for a query that is
    // no longer on screen.
    let resolveSlow: (v: { name: string }[]) => void = () => {};
    const fetcher = jest.fn()
      .mockImplementationOnce(() => new Promise<{ name: string }[]>((r) => { resolveSlow = r; }))
      .mockImplementationOnce(() => Promise.resolve([{ name: "Chipotle" }]));

    const { ctrl, get } = harness(fetcher);
    ctrl.setQuery("chi");
    jest.advanceTimersByTime(200);
    ctrl.setQuery("chipotle");
    jest.advanceTimersByTime(200);
    await Promise.resolve(); await Promise.resolve();
    expect(get().suggestions).toEqual([{ name: "Chipotle" }]);

    resolveSlow([{ name: "China Wok" }]);
    await Promise.resolve(); await Promise.resolve();
    expect(get().suggestions).toEqual([{ name: "Chipotle" }]);
  });

  it("clears when the box is emptied", async () => {
    const fetcher = jest.fn().mockResolvedValue([{ name: "Chipotle" }]);
    const { ctrl, get } = harness(fetcher);
    ctrl.setQuery("chipotle");
    jest.advanceTimersByTime(200);
    await Promise.resolve(); await Promise.resolve();
    expect(get().suggestions).toHaveLength(1);
    ctrl.setQuery("");
    expect(get()).toEqual({ suggestions: [], loading: false });
  });

  it("says nothing rather than showing stale rows when a lookup fails", async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error("offline"));
    const { ctrl, get } = harness(fetcher);
    ctrl.setQuery("chipotle");
    jest.advanceTimersByTime(200);
    await Promise.resolve(); await Promise.resolve();
    expect(get()).toEqual({ suggestions: [], loading: false });
  });

  it("stops answering after dispose", async () => {
    const fetcher = jest.fn().mockResolvedValue([{ name: "Chipotle" }]);
    const { ctrl, get } = harness(fetcher);
    ctrl.setQuery("chipotle");
    ctrl.dispose();
    jest.advanceTimersByTime(500);
    await Promise.resolve(); await Promise.resolve();
    expect(get().suggestions).toEqual([]);
  });
});
