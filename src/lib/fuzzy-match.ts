/**
 * Fuzzy Matching for Cross-Platform Market Discovery
 * 
 * Matches election markets between Polymarket and Kalshi
 * using token-based similarity scoring
 */

// Common words to ignore in matching
const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'be', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'or', 'and', 'if', 'before', 'after', 'during', 'until',
  'who', 'what', 'when', 'where', 'how', 'which',
  'yes', 'no', 'win', 'winner', 'wins', 'winning',
  'election', 'elections', 'presidential', 'president',
  '2024', '2025', '2026',
]);

// Key political entities to boost matching weight
const KEY_ENTITIES: Record<string, string[]> = {
  'trump': ['donald', 'trump', 'djt'],
  'biden': ['joe', 'biden', 'joseph'],
  'harris': ['kamala', 'harris'],
  'desantis': ['ron', 'desantis'],
  'newsom': ['gavin', 'newsom'],
  'gop': ['republican', 'republicans', 'gop', 'rnc'],
  'dem': ['democrat', 'democrats', 'democratic', 'dnc'],
  'senate': ['senate', 'senator'],
  'house': ['house', 'congress', 'congressional'],
  'scotus': ['supreme', 'court', 'scotus'],
  'fed': ['fed', 'federal', 'reserve', 'fomc'],
};

/**
 * Normalize and tokenize a title
 */
function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Extract key entities from tokens
 */
function extractEntities(tokens: string[]): Set<string> {
  const entities = new Set<string>();
  
  for (const token of tokens) {
    for (const [entity, aliases] of Object.entries(KEY_ENTITIES)) {
      if (aliases.includes(token)) {
        entities.add(entity);
      }
    }
  }
  
  return entities;
}

/**
 * Calculate similarity score between two titles (0-100)
 */
export function calculateSimilarity(title1: string, title2: string): number {
  const tokens1 = tokenize(title1);
  const tokens2 = tokenize(title2);
  
  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0;
  }
  
  // Token overlap (Jaccard-like)
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection = new Set(Array.from(set1).filter(t => set2.has(t)));
  const union = new Set(Array.from(set1).concat(Array.from(set2)));
  
  const tokenScore = (intersection.size / union.size) * 100;
  
  // Entity matching bonus
  const entities1 = extractEntities(tokens1);
  const entities2 = extractEntities(tokens2);
  const entityIntersection = new Set(Array.from(entities1).filter(e => entities2.has(e)));
  
  let entityBonus = 0;
  if (entities1.size > 0 && entities2.size > 0) {
    // If they share key entities, boost the score
    const entityOverlap = entityIntersection.size / Math.max(entities1.size, entities2.size);
    entityBonus = entityOverlap * 30; // Up to 30 point bonus
  }
  
  // Combine scores (cap at 100)
  const finalScore = Math.min(100, tokenScore + entityBonus);
  
  return Math.round(finalScore * 100) / 100;
}

/**
 * Find best matches for a market from a list of candidates
 */
export function findBestMatches(
  sourceTitle: string,
  candidates: Array<{ id: number; title: string }>,
  minScore: number = 80,
  maxResults: number = 3
): Array<{ id: number; title: string; score: number }> {
  const scored = candidates
    .map(candidate => ({
      ...candidate,
      score: calculateSimilarity(sourceTitle, candidate.title),
    }))
    .filter(m => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  
  return scored;
}

/**
 * Check if a title appears to be election-related
 */
export function isElectionRelated(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  
  const electionKeywords = [
    'elect', 'vote', 'ballot', 'president', 'senate', 'house', 'congress',
    'governor', 'democrat', 'republican', 'gop', 'dnc', 'rnc', 'primary',
    'nomination', 'nominee', 'trump', 'biden', 'harris', 'cabinet',
    'secretary', 'attorney general', 'scotus', 'supreme court',
    'impeach', 'pardon', 'veto', 'executive order',
  ];
  
  return electionKeywords.some(keyword => lowerTitle.includes(keyword));
}

/**
 * Check if a market has election-related tags
 */
export function hasElectionTag(tags: string[] | null | undefined): boolean {
  if (!tags || !Array.isArray(tags)) return false;
  
  const electionTags = ['politics', 'elections', 'us-politics', 'government'];
  return tags.some(tag => electionTags.includes(tag.toLowerCase()));
}
