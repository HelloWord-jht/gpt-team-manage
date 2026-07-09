import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAccountDraft,
  removeDraftMember,
  saveDraftMember,
} from "../public/accountDraft.js";

describe("account draft", () => {
  it("clones account notes and members without mutating the loaded account", () => {
    const account = {
      id: "demo",
      email: "demo@example.com",
      openedAt: "2026-06-01",
      status: "blocked",
      region: "Japan",
      cost: "USD 20",
      profit: 80,
      notes: ["Needs review"],
      members: [
        {
          name: "A",
          email: "a@example.com",
          price: 100,
          joinedAt: "2026-06-01",
          leftAt: "",
          paymentStatus: "paid",
        },
      ],
    };

    const draft = createAccountDraft(account, "2026-06-30");
    draft.notes[0] = "Changed note";
    draft.members[0].name = "Changed";

    assert.deepEqual(account.notes, ["Needs review"]);
    assert.equal(account.members[0].name, "A");
    assert.notStrictEqual(draft.notes, account.notes);
    assert.notStrictEqual(draft.members, account.members);
    assert.notStrictEqual(draft.members[0], account.members[0]);
    assert.deepEqual(draft, {
      ...account,
      notes: ["Changed note"],
      members: [{ ...account.members[0], name: "Changed" }],
    });
  });

  it("creates a new account draft with defaults and no members", () => {
    assert.deepEqual(createAccountDraft(null, "2026-06-30"), {
      id: "",
      email: "",
      openedAt: "2026-06-30",
      status: "active",
      region: "",
      cost: "",
      profit: 0,
      notes: [],
      members: [],
    });
  });

  it("replaces a valid member immutably and clones member fields", () => {
    const draft = createAccountDraft(
      {
        members: [
          { name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "", paymentStatus: "paid" },
          { name: "B", email: "b@example.com", price: 110, joinedAt: "2026-06-02", leftAt: "" },
        ],
      },
      "2026-06-30",
    );
    const member = {
      name: "Changed",
      email: "changed@example.com",
      price: 120,
      joinedAt: "2026-06-03",
      leftAt: "2026-06-29",
      paymentStatus: "partial",
      ignored: true,
    };

    const changed = saveDraftMember(draft, 0, member);
    member.name = "Mutated later";

    assert.equal(draft.members[0].name, "A");
    assert.deepEqual(changed.members[0], {
      name: "Changed",
      email: "changed@example.com",
      price: 120,
      joinedAt: "2026-06-03",
      leftAt: "2026-06-29",
      paymentStatus: "partial",
    });
    assert.notStrictEqual(changed, draft);
    assert.notStrictEqual(changed.members, draft.members);
    assert.notStrictEqual(changed.members[1], draft.members[1]);
  });

  it("appends members for new or invalid indexes", () => {
    const member = {
      name: "A",
      email: "a@example.com",
      price: 120,
      joinedAt: "2026-06-30",
      leftAt: "",
      paymentStatus: "unpaid",
    };

    for (const index of [null, -1, 0, 1.5, "0"]) {
      const draft = createAccountDraft(null, "2026-06-30");
      const added = saveDraftMember(draft, index, member);

      assert.equal(draft.members.length, 0);
      assert.deepEqual(added.members, [member]);
      assert.notStrictEqual(added.members[0], member);
    }
  });

  it("removes a member immutably", () => {
    const draft = createAccountDraft(
      {
        members: [
          { name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "" },
          { name: "B", email: "b@example.com", price: 110, joinedAt: "2026-06-02", leftAt: "" },
        ],
      },
      "2026-06-30",
    );

    const removed = removeDraftMember(draft, 0);

    assert.deepEqual(draft.members.map(({ name }) => name), ["A", "B"]);
    assert.deepEqual(removed.members.map(({ name }) => name), ["B"]);
    assert.notStrictEqual(removed, draft);
    assert.notStrictEqual(removed.members, draft.members);
    assert.notStrictEqual(removed.members[0], draft.members[1]);
  });
});
