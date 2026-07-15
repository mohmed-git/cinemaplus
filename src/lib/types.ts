import type { Category } from './site';

export interface Server {
  id: number;
  label: string;
  url: string;
}

export interface Episode {
  episode: number;
  title: string;
  servers: Server[];
  overview?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  tmdb_episode_id?: number | null;
  tmdb_still_path?: string | null;
}

export interface Season {
  season: number;
  episodes_count: number;
  episodes: Episode[];
}

export interface Title {
  slug: string;
  clean_title: string;
  raw_name: string;
  category: Category;
  category_label: string;
  poster: string | null;
  note: string | null;
  matched_poster: boolean;
  seasons_count: number;
  episodes_count: number;
  seasons: Season[];
  description: string;
  url: string;
  // Extended metadata (movies)
  story?: string | null;
  year?: string | null;
  quality?: string | null;
  duration?: string | null;
  language?: string | null;
  country?: string | null;
  director?: string | null;
  stars?: string | null;
  genre?: string | null;
  trailerId?: string | null;
  rating?: string | number | null;
  imdb_rating?: string | number | null;
  tmdb_id?: number | null;
  tmdb_url?: string | null;
  original_title?: string | null;
  // --- TMDB enrichment (cast/metadata pass) ---
  tmdb_type?: 'movie' | 'tv';
  title_ar?: string | null;
  overview_ar?: string | null;
  overview_en?: string | null;
  genres?: string[];
  vote_average?: number | null;
  vote_count?: number | null;
  imdb_id?: string | null;
  runtime?: number | null;
  backdrop_path?: string | null;
  creators?: string[];
  spoken_languages?: string[];
  production_countries?: string[];
  status?: string | null;
  number_of_episodes?: number | null;
  number_of_seasons?: number | null;
  cast?: Array<{
    name: string;
    character?: string;
    profilePath?: string | null;
    tmdbId?: number | null;
    order?: number;
  }>;
  // TMDB-backed sort/credibility metadata (added by build-data.mjs)
  tmdb_vote?: number;
  tmdb_votes?: number;
  release_date?: string;
  sort_rating?: number;
  sort_recent?: number;
  real_plot?: boolean;
  is_special?: boolean;
  relatedAnimeSeasons?: Array<{
    slug: string;
    title: string;
    url: string;
    season: number | null;
    seasonLabel: string;
    episodesCount: number;
    poster: string | null;
  }>;
  seoContent?: {
    generatedAt?: string;
    arabicTitle?: string;
    primaryCharacter?: string;
    mainDescription?: string;
    metaDescription?: string;
    highlights?: string;
    beforeWatching?: string;
    beforeWatchingPoints?: string[];
    faqs?: Array<{
      question: string;
      answer: string;
    }>;
    sources?: {
      imdb?: string | null;
      imdbApi?: string | null;
      wikipedia?: string | null;
      myAnimeList?: string | null;
      rottenTomatoes?: string | null;
      tmdb?: string | null;
    };
  };
}

export interface TitleIndexEntry {
  slug: string;
  clean_title: string;
  category: Category;
  category_label: string;
  poster: string | null;
  seasons_count: number;
  episodes_count: number;
  url: string;
  has_multiple_seasons: boolean;
  year?: string | null;
  genres?: string[];
  rating?: number;
  votes?: number;
  sort_rating?: number;
  sort_recent?: number;
  is_special?: boolean;
}
