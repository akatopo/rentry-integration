// https://github.com/mathiasbynens/utf8.js/blob/2ce09544b62f2a274dbcd249473c0986e3660849/utf8.js#L7
export function ucs2decode(s: string) {
  const output = [];
  let counter = 0;
  const { length } = s;
  let value;
  let extra;
  while (counter < length) {
    value = s.charCodeAt(counter++);
    if (value >= 0xd800 && value <= 0xdbff && counter < length) {
      // high surrogate, and there is a next character
      extra = s.charCodeAt(counter++);
      if ((extra & 0xfc00) == 0xdc00) {
        // low surrogate
        output.push(((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000);
      } else {
        // unmatched surrogate; only append this code unit, in case the next
        // code unit is the high surrogate of a surrogate pair
        output.push(value);
        counter--;
      }
    } else {
      output.push(value);
    }
  }
  return output;
}
