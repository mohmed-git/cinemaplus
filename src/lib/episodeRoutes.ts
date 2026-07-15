import type { Episode, Season, Title } from './types';
import { detailRoute, seasonRoute, episodeRoute, gatewayRoute } from './routes';

export type EpisodicKind = 'series' | 'anime';

export interface EpisodeRef {
  season: number;
  episode: number;
  title: string;
}

export function isEpisodicKind(category: Title['category']): category is EpisodicKind {
  return category === 'series' || category === 'anime';
}

export function hasEpisodePages(title: Title): boolean {
  return isEpisodicKind(title.category) && title.episodes_count > 1 && title.seasons.length > 0;
}

export function sortedSeasons(title: Title): Season[] {
  return [...title.seasons]
    .filter((season) => season.episodes.length > 0)
    .sort((a, b) => a.season - b.season)
    .map((season) => ({
      ...season,
      episodes: sortedEpisodes(season),
    }));
}

export function sortedEpisodes(season: Season): Episode[] {
  return [...season.episodes].sort((a, b) => a.episode - b.episode);
}

export function getSeasonRoute(kind: EpisodicKind, slug: string, season: number): string {
  return seasonRoute(kind, slug, season);
}

export function getRouteSlug(title: Title, _kind: EpisodicKind): string {
  // Slugs stay the original slug; the title.url is already opaque-encoded.
  return title.slug;
}

export function getTitleRoute(title: Title, kind: EpisodicKind): string {
  return detailRoute(kind, getRouteSlug(title, kind));
}

export function getSeasonRouteForTitle(title: Title, kind: EpisodicKind, season: number): string {
  return seasonRoute(kind, getRouteSlug(title, kind), season);
}

export function getEpisodeRoute(
  kind: EpisodicKind,
  slug: string,
  season: number,
  episode: number
): string {
  return episodeRoute(kind, slug, season, episode);
}

export function getEpisodeRouteForTitle(
  title: Title,
  kind: EpisodicKind,
  season: number,
  episode: number
): string {
  return episodeRoute(kind, getRouteSlug(title, kind), season, episode);
}

export function getGatewayEpisodeRouteForTitle(
  title: Title,
  season: number,
  episode: number
): string {
  return `${gatewayRoute(title.slug)}?s=${season}&e=${episode}`;
}

export function getFirstEpisodeRoute(title: Title, kind: EpisodicKind): string {
  const firstSeason = sortedSeasons(title)[0];
  const firstEpisode = firstSeason?.episodes[0];
  if (!firstSeason || !firstEpisode) return getTitleRoute(title, kind);
  return getEpisodeRouteForTitle(title, kind, firstSeason.season, firstEpisode.episode);
}

export function getFirstEpisodeWatchRoute(title: Title, kind: EpisodicKind): string {
  const firstSeason = sortedSeasons(title)[0];
  const firstEpisode = firstSeason?.episodes[0];
  if (!firstSeason || !firstEpisode) return getTitleRoute(title, kind);
  return getGatewayEpisodeRouteForTitle(title, firstSeason.season, firstEpisode.episode);
}

export function getNavigableEpisodeRouteForTitle(
  title: Title,
  kind: EpisodicKind,
  season: number,
  episode: number
): string {
  // Episode pages are back as standalone SSR routes (/.../c/{season}/e/{episode}).
  // Internal links point straight at them so crawlers get a real, indexable URL
  // per episode instead of the old client-side ?e= query-string variant.
  return getEpisodeRouteForTitle(title, kind, season, episode);
}

export function getFlatEpisodes(title: Title): EpisodeRef[] {
  return sortedSeasons(title).flatMap((season) =>
    season.episodes.map((episode) => ({
      season: season.season,
      episode: episode.episode,
      title: episode.title,
    }))
  );
}

export function findEpisode(title: Title, seasonNumber: number, episodeNumber: number) {
  const seasons = sortedSeasons(title);
  const season = seasons.find((item) => item.season === seasonNumber) ?? seasons[0];
  const episode =
    season?.episodes.find((item) => item.episode === episodeNumber) ?? season?.episodes[0] ?? null;
  return { seasons, season, episode };
}

export function getEpisodeNeighbors(
  title: Title,
  seasonNumber: number,
  episodeNumber: number
): { previous: EpisodeRef | null; next: EpisodeRef | null } {
  const flat = getFlatEpisodes(title);
  const index = flat.findIndex(
    (item) => item.season === seasonNumber && item.episode === episodeNumber
  );
  if (index === -1) return { previous: null, next: null };
  return {
    previous: flat[index - 1] ?? null,
    next: flat[index + 1] ?? null,
  };
}
