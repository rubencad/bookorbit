import { pseConversionFor, pseStreamType } from '../opds-pse';

describe('pseStreamType', () => {
  it('streams all-JPEG and all-PNG archives in their own type', () => {
    expect(pseStreamType('image/jpeg')).toBe('image/jpeg');
    expect(pseStreamType('image/png')).toBe('image/png');
  });

  it('falls back to JPEG for mixed, uncounted, and unsupported archives', () => {
    expect(pseStreamType(null)).toBe('image/jpeg');
    expect(pseStreamType('image/webp')).toBe('image/jpeg');
    expect(pseStreamType('image/gif')).toBe('image/jpeg');
  });
});

describe('pseConversionFor', () => {
  it('leaves pages that already match the advertised type alone', () => {
    expect(pseConversionFor('image/jpeg', 'image/jpeg')).toBeUndefined();
    expect(pseConversionFor('image/png', 'image/png')).toBeUndefined();
  });

  it('converts every other page to the advertised type', () => {
    expect(pseConversionFor('image/jpeg', 'image/png')).toBe('jpeg');
    expect(pseConversionFor('image/jpeg', 'image/webp')).toBe('jpeg');
    expect(pseConversionFor('image/png', 'image/jpeg')).toBe('png');
  });
});
