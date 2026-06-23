/**
 * Strip HTML tags to a fixed point (re-runs until no more matches), so a tag
 * straddling a removed match (e.g. `<scr<script>ipt>`) can't survive a single pass.
 */
export function stripHtmlTags(value: string): string {
  let result = value;
  let previous: string;
  do {
    previous = result;
    result = previous.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
}
