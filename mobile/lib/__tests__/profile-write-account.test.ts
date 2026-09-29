import { setUsername, setDisplayName } from "../profile";
import { __resetUsernameGate, setUsernameGateAccount, usernameGateSession } from "../username-gate";
import { supabase } from "../supabase";
jest.mock("../supabase", () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));
const getUser = supabase.auth.getUser as jest.Mock;
const from = supabase.from as jest.Mock;
let finishAuth: (value: any) => void;
const eq = jest.fn(async () => ({ error: null }));
const update = jest.fn(() => ({ eq }));
beforeEach(() => {
  jest.clearAllMocks(); __resetUsernameGate(); setUsernameGateAccount("A");
  getUser.mockImplementation(() => new Promise(resolve => { finishAuth = resolve; }));
  from.mockReturnValue({ update });
});
for (const method of ["username", "name"] as const) {
  for (const transition of ["B", "A-B-A", "sign-out"] as const) {
    test(`${method} refuses ${transition} before submitting old input`, async () => {
      const token = usernameGateSession();
      const result = (method === "username" ? setUsername("old_handle", token) : setDisplayName("Old name", token)).catch(e => e);
      setUsernameGateAccount(transition === "sign-out" ? null : "B");
      if (transition === "A-B-A") setUsernameGateAccount("A");
      finishAuth({ data: { user: transition === "sign-out" ? null : { id: transition === "B" ? "B" : "A" } } });
      await result;
      expect(from).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  }
  test(`${method} pins a current submission to its initiating account`, async () => {
    const result = method === "username" ? setUsername("valid_handle") : setDisplayName("Valid name");
    finishAuth({ data: { user: { id: "A" } } });
    await result;
    expect(eq).toHaveBeenCalledWith("id", "A");
    expect(update).toHaveBeenCalledTimes(1);
  });
}
