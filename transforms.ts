import TurndownService from 'turndown';
import { source } from 'common-tags';
import { getGraphemeCount, isRecord, getFrontmatterEndOffset } from './util.js';
import { rentryPropNames } from './frontmatter-props.js';

import type { TFile, App } from 'obsidian';
import type { EmbedData, ResolvedEmbed } from './embeds.js';

export function removeRentryPropsFromFrontmatterObject(frontmatter: unknown) {
  if (!isRecord(frontmatter)) {
    return;
  }

  rentryPropNames.forEach((key) => {
    if (Object.hasOwn(frontmatter, key)) {
      delete frontmatter[key];
    }
  });
}

export function removeEmptyPropsFromFrontmatterObject(frontmatter: unknown) {
  if (!isRecord(frontmatter)) {
    return;
  }

  Object.entries(frontmatter).forEach(([key, value]) => {
    if (
      value === null ||
      value === '' ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete frontmatter[key];
    }
  });
}

export function tryRenderFrontmatterText(frontmatter: unknown) {
  if (!isRecord(frontmatter)) {
    return '';
  }
  const { escape: escapeMd } = new TurndownService();

  // TODO Could look into better handling of "wide" characters like emoji for calculating col length, see how prettier does it

  const propColLabel = 'Property';
  const valueColLabel = 'Value';
  const toEscapedString = (x: unknown) => {
    if (x === null) {
      return '';
    }
    if (Array.isArray(x)) {
      // https://rentry.co/how: Adding \n triggers a newline within cells and headers
      return x
        .map((s) => escapeMd(x.length > 1 ? `- ${s}` : String(s)))
        .join(' \\n ');
    }
    return String(x);
  };
  const frontmatterEntries = [...Object.entries(frontmatter)].map(
    ([property, value]) => [escapeMd(property), toEscapedString(value)],
  );

  if (frontmatterEntries.length === 0) {
    return '';
  }

  const maxColLength = [
    ...frontmatterEntries,
    [propColLabel, valueColLabel],
  ].reduce(
    (prev, [property, value]) => [
      Math.max(prev[0], getGraphemeCount(property)),
      Math.max(prev[1], getGraphemeCount(value)),
    ],
    [0, 0],
  );

  const padLabelWithSpaces = (label: string, max: number) =>
    `${label}${Array(Math.max(0, max - getGraphemeCount(label)))
      .fill(' ')
      .join('')}`;
  const fillWithDashes = (headingLabel: string, max: number) =>
    Array(Math.max(getGraphemeCount(headingLabel), max))
      .fill('-')
      .join('');
  const rows = frontmatterEntries.map(
    ([property, value]) =>
      `| ${padLabelWithSpaces(
        property,
        maxColLength[0],
      )} | ${padLabelWithSpaces(value, maxColLength[1])} |`,
  );

  return source`
    | ${padLabelWithSpaces(
      propColLabel,
      maxColLength[0],
    )} | ${padLabelWithSpaces(valueColLabel, maxColLength[1])} |
    | ${fillWithDashes(propColLabel, maxColLength[0])} | ${fillWithDashes(
    valueColLabel,
    maxColLength[1],
  )} |
    ${rows}
  `;
}

export async function replaceResolvedEmbeds(
  resolvedEmbeds: ResolvedEmbed[],
  embedData: EmbedData,
  text: string,
) {
  const { pathMap } = embedData;

  const res = resolvedEmbeds.reduce(
    (prev, cur) => {
      const { replacedText, positionOffset } = prev;
      const { position, displayText, fullPath, original } = cur;
      const { offset: startOffset } = position.start;
      const { offset: endOffset } = position.end;
      const sliced = text.slice(positionOffset, startOffset);
      const data = fullPath ? pathMap[fullPath] : undefined;
      const res = {
        replacedText: replacedText.concat(
          sliced,
          data ? `![${displayText}](${data.url})` : original,
        ),
        positionOffset: endOffset,
      };
      return res;
    },
    { replacedText: '', positionOffset: 0 },
  );

  return res.replacedText.concat(text.slice(res.positionOffset));
}

export function removeFrontmatterFromText(text: string, file: TFile, app: App) {
  const frontmatterEndOffset = getFrontmatterEndOffset(file, app);

  return text.slice(frontmatterEndOffset);
}
