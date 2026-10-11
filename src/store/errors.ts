export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'out_of_stock'
  | 'invalid_coupon'
  | 'empty_cart'
  | 'invalid_shipping'
  | 'already_ordered'
  | 'payload_too_large'
  | 'conflict';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
