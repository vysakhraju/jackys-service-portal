import { RefreshAuthGuard } from './refresh-auth.guard';

describe('RefreshAuthGuard', () => {
  it('delegates canActivate to the passport AuthGuard implementation', () => {
    const guard = new RefreshAuthGuard();
    const superCanActivate = jest
      .spyOn(Object.getPrototypeOf(RefreshAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true as any);

    const context = {} as any;
    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(superCanActivate).toHaveBeenCalledWith(context);
    superCanActivate.mockRestore();
  });
});
