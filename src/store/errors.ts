export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'out_of_stock'
  | 'invalid_coupon'
  | 'empty_cart'
  | 'invalid_shipping'
  | 'conflict';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
