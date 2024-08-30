/**
 * 检查传入的是否符合Promise A+ 规范，也就是检查是否为promise
 * @param wat A value to be checked.
 */
export function isThenable(wat: any): wat is PromiseLike<any> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return Boolean(wat && wat.then && typeof wat.then === 'function');
}
