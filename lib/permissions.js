function isAdmin(auth) {
  return auth?.isAdmin === true;
}

function getCurrentOwner(auth) {
  return auth?.user?.owner || null;
}

function canViewItem(auth, item) {
  if (!auth?.isAuthenticated) return false;
  if (isAdmin(auth)) return true;
  const currentOwner = getCurrentOwner(auth);
  const itemOwner = item?.owner || "";
  if (!itemOwner) return true;
  if (!currentOwner) return false;
  return itemOwner === currentOwner;
}

function canEditItem(auth, item) {
  return canViewItem(auth, item);
}

function canCreateItem(auth, newItemData) {
  if (!auth?.isAuthenticated) return false;
  if (isAdmin(auth)) return true;
  const currentOwner = getCurrentOwner(auth);
  const newOwner = newItemData?.owner || "";
  if (!newOwner) return true;
  if (!currentOwner) return false;
  return newOwner === currentOwner;
}

function canChangeItemOwner(auth, currentItem, newOwner) {
  if (isAdmin(auth)) return true;
  return false;
}

function filterItemsByOwner(auth, items) {
  if (!auth?.isAuthenticated) return [];
  if (isAdmin(auth)) return items;
  const currentOwner = getCurrentOwner(auth);
  return items.filter(item => {
    const itemOwner = item?.owner || "";
    if (!itemOwner) return true;
    if (!currentOwner) return false;
    return itemOwner === currentOwner;
  });
}

function filterTasksByOwner(auth, tasks) {
  if (!auth?.isAuthenticated) return [];
  if (isAdmin(auth)) return tasks;
  const currentOwner = getCurrentOwner(auth);
  return tasks.filter(task => {
    const taskOwner = task?.modelOwner || "";
    if (!taskOwner) return true;
    if (!currentOwner) return false;
    return taskOwner === currentOwner;
  });
}

function filterOwnersForSelection(auth, allOwners) {
  if (isAdmin(auth)) return allOwners;
  const currentOwner = getCurrentOwner(auth);
  if (!currentOwner) return [];
  return allOwners.filter(o => o === currentOwner);
}

export {
  isAdmin,
  getCurrentOwner,
  canViewItem,
  canEditItem,
  canCreateItem,
  canChangeItemOwner,
  filterItemsByOwner,
  filterTasksByOwner,
  filterOwnersForSelection
};
