export function getTeamAlignment(
  polyTitle: string,
  kalshiTitle: string
): { sidesInverted: boolean; polyTeam1: string | null; kalshiTeam1: string | null } {
  const polyTeams = extractTeams(polyTitle);
  const kalshiTeams = extractTeams(kalshiTitle);

  const team1Aligned = teamsMatch(polyTeams.team1, kalshiTeams.team1);
  const team1InvertedMatch = teamsMatch(polyTeams.team1, kalshiTeams.team2);
  const sidesInverted = !team1Aligned && team1InvertedMatch;

  return {
    sidesInverted,
    polyTeam1: polyTeams.team1,
    kalshiTeam1: kalshiTeams.team1,
  };
}

function extractTeams(title: string): { team1: string | null; team2: string | null } {
  const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s+Winner)?$/i);
  if (vsMatch) {
    return { team1: vsMatch[1].trim(), team2: vsMatch[2].trim() };
  }

  const atMatch = title.match(/^(.+?)\s+at\s+(.+?)\s+Winner\??$/i);
  if (atMatch) {
    return { team1: atMatch[1].trim(), team2: atMatch[2].trim() };
  }

  return { team1: null, team2: null };
}

function teamsMatch(name1: string | null, name2: string | null): boolean {
  if (!name1 || !name2) return false;

  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  if (n1.includes(n2) || n2.includes(n1)) return true;

  const mappings: Record<string, string[]> = {
    '49ers': ['san francisco', 'sf', 'niners'],
    'eagles': ['philadelphia', 'philly'],
    'bills': ['buffalo'],
    'jaguars': ['jacksonville', 'jags'],
    'chiefs': ['kansas city', 'kc'],
    'ravens': ['baltimore'],
    'cowboys': ['dallas'],
    'packers': ['green bay', 'gb'],
    'lions': ['detroit'],
    'bears': ['chicago'],
    'vikings': ['minnesota'],
    'commanders': ['washington'],
    'giants': ['new york', 'ny giants'],
    'jets': ['new york', 'ny jets'],
    'dolphins': ['miami'],
    'patriots': ['new england'],
    'steelers': ['pittsburgh'],
    'bengals': ['cincinnati'],
    'browns': ['cleveland'],
    'texans': ['houston'],
    'colts': ['indianapolis', 'indy'],
    'titans': ['tennessee'],
    'broncos': ['denver'],
    'chargers': ['los angeles', 'la chargers'],
    'raiders': ['las vegas', 'lv'],
    'seahawks': ['seattle'],
    'cardinals': ['arizona'],
    'rams': ['los angeles', 'la rams'],
    'saints': ['new orleans'],
    'buccaneers': ['tampa bay', 'bucs'],
    'falcons': ['atlanta'],
    'panthers': ['carolina'],
  };

  for (const [mascot, cities] of Object.entries(mappings)) {
    const allNames = [mascot, ...cities];
    const n1Match = allNames.some(name => n1.includes(name));
    const n2Match = allNames.some(name => n2.includes(name));
    if (n1Match && n2Match) return true;
  }

  return false;
}
