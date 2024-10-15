/**
 * 根据传入的初始时间和持续时间，判断时间戳是否已经过期
 */
export function isExpired(
  initialTime: null | number,
  expiry: undefined | number,
  targetTime: number = +new Date(),
): boolean {
  // 表示会话已过期，直接返回
  if (initialTime === null || expiry === undefined || expiry < 0) {
    return true;
  }

  // 如果 expiry 为 0，表示这个时间没有过期时限，返回 false，表示永不过期。
  if (expiry === 0) {
    return false;
  }

  // 初始时间加上有效期已经小于或等于目标时间，表示已经过期
  return initialTime + expiry <= targetTime;
}
