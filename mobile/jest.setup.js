// jest.setup.js — global mocks for tests.
// AsyncStorage doesn't run in node; we use the official mock.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Mock the supabase client entirely — tests don't need a real connection,
// and importing it without env vars throws. Each lib that uses supabase
// should already handle network failure gracefully (we only test pure logic).
jest.mock("./lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ data: [], error: null }),
        order: () => ({ limit: () => ({ data: [], error: null }) }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
