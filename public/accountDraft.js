export function createAccountDraft(account, today) {
  return {
    id: account?.id || "",
    email: account?.email || "",
    openedAt: account?.openedAt || today,
    status: account?.status || "active",
    region: account?.region || "",
    cost: account?.cost || "",
    profit: account?.profit ?? 0,
    notes: Array.isArray(account?.notes) ? [...account.notes] : [],
    members: Array.isArray(account?.members) ? account.members.map(cloneMember) : [],
  };
}

export function saveDraftMember(draft, index, member) {
  const members = draft.members.map(cloneMember);

  if (Number.isInteger(index) && index >= 0 && index < members.length) {
    members[index] = cloneMember(member);
  } else {
    members.push(cloneMember(member));
  }

  return { ...draft, members };
}

export function removeDraftMember(draft, index) {
  return {
    ...draft,
    members: draft.members
      .filter((_, memberIndex) => memberIndex !== index)
      .map(cloneMember),
  };
}

function cloneMember(member) {
  return {
    name: String(member?.name || ""),
    email: String(member?.email || ""),
    price: member?.price ?? "",
    joinedAt: String(member?.joinedAt || ""),
    leftAt: String(member?.leftAt || ""),
    paymentStatus: String(member?.paymentStatus || "unpaid"),
  };
}
