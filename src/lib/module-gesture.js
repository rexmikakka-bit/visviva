// Row keys change with weapon state. Keep gesture history in the fitting tab,
// identified by actual slots so a regroup/remount cannot lose a tap or held flag.
export function moduleGestureHistory(memory, rack, row) {
  const ids=row.groupIds??[row.id];
  const previous=memory.current;
  if(!previous||previous.rack!==rack||!ids.some(id=>previous.ids.includes(id))) {
    memory.current={rack,ids:[...ids],lastTap:0,held:false};
  }
  return memory.current;
}
