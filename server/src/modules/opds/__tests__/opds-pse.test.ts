import { isPseStreamFormat, pseConversionFor, pseStreamFormat, pseStreamType } from '../opds-pse';

describe('pseStreamFormat', () => {
  it('streams all-PNG archives as PNG', () => {
    expect(pseStreamFormat('image/png')).toBe('png');
  });

  it('falls back to JPEG for JPEG, mixed, undetermined, and unsupported archives', () => {
    expect(pseStreamFormat('image/jpeg')).toBe('jpeg');
    expect(pseStreamFormat('image/*')).toBe('jpeg');
    expect(pseStreamFormat(null)).toBe('jpeg');
    expect(pseStreamFormat('image/webp')).toBe('jpeg');
    expect(pseStreamFormat('image/gif')).toBe('jpeg');
  });
});

describe('pseStreamType', () => {
  it('maps a stream format to its media type', () => {
    expect(pseStreamType('jpeg')).toBe('image/jpeg');
    expect(pseStreamType('png')).toBe('image/png');
  });
});

describe('isPseStreamFormat', () => {
  it('accepts only the two formats a link can advertise', () => {
    expect(isPseStreamFormat('jpeg')).toBe(true);
    expect(isPseStreamFormat('png')).toBe(true);
    expect(isPseStreamFormat('gif')).toBe(false);
    expect(isPseStreamFormat('JPEG')).toBe(false);
    expect(isPseStreamFormat('image/jpeg')).toBe(false);
  });
});

describe('pseConversionFor', () => {
  it('leaves pages that already match the advertised format alone', () => {
    expect(pseConversionFor('jpeg', 'image/jpeg')).toBeUndefined();
    expect(pseConversionFor('png', 'image/png')).toBeUndefined();
  });

  it('converts every other page to the advertised format', () => {
    expect(pseConversionFor('jpeg', 'image/png')).toBe('jpeg');
    expect(pseConversionFor('jpeg', 'image/webp')).toBe('jpeg');
    expect(pseConversionFor('png', 'image/jpeg')).toBe('png');
  });
});
