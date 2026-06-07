// Integration: favourites toggle saves to server and round-trips correctly

// Simulates the in-app toggleFavourite logic + server persistence
const makeFavouritesStore = (initial = []) => {
  let serverState = [...initial];
  const save = (next) => { serverState = [...next]; };
  const load = () => [...serverState];
  let clientState = [...initial];

  const toggle = (key) => {
    const next = clientState.includes(key)
      ? clientState.filter(x => x !== key)
      : [...clientState, key];
    save(next); // persists to "server"
    clientState = next;
    return [...clientState];
  };

  return { toggle, load, getClient: () => clientState };
};

describe('Favourites persistence (toggle logic)', () => {
  test('adding a favourite updates client state', () => {
    const store = makeFavouritesStore([]);
    const result = store.toggle('bills');
    expect(result).toContain('bills');
  });

  test('adding a favourite persists to server', () => {
    const store = makeFavouritesStore([]);
    store.toggle('bills');
    expect(store.load()).toContain('bills');
  });

  test('toggling again removes the favourite', () => {
    const store = makeFavouritesStore(['bills']);
    const result = store.toggle('bills');
    expect(result).not.toContain('bills');
  });

  test('removing persists to server', () => {
    const store = makeFavouritesStore(['bills']);
    store.toggle('bills');
    expect(store.load()).not.toContain('bills');
  });

  test('multiple favourites accumulate', () => {
    const store = makeFavouritesStore([]);
    store.toggle('bills');
    store.toggle('stocks');
    store.toggle('vacations');
    expect(store.load()).toEqual(['bills', 'stocks', 'vacations']);
  });

  test('removing one does not affect others', () => {
    const store = makeFavouritesStore(['bills', 'stocks']);
    store.toggle('bills');
    expect(store.load()).toEqual(['stocks']);
    expect(store.load()).not.toContain('bills');
  });

  test('load after restart restores state', () => {
    const store = makeFavouritesStore([]);
    store.toggle('vacations');
    // Simulate fresh page load — load from server
    const restored = store.load();
    expect(restored).toContain('vacations');
  });

  test('toggling same key twice is a no-op net effect', () => {
    const store = makeFavouritesStore(['bills']);
    store.toggle('bills');
    store.toggle('bills');
    expect(store.load()).toContain('bills');
  });
});

// ── Load-on-startup logic ──────────────────────────────────────────────────
describe('Favourites load-on-startup logic', () => {
  const applyServerData = (d, setFavourites) => {
    if (d.favourites) setFavourites(d.favourites);
  };

  test('loads favourites array from server data', () => {
    let fav = [];
    applyServerData({ favourites: ['bills', 'stocks'] }, v => { fav = v; });
    expect(fav).toEqual(['bills', 'stocks']);
  });

  test('skips when server data has no favourites key', () => {
    let fav = ['default'];
    applyServerData({}, v => { fav = v; });
    expect(fav).toEqual(['default']); // unchanged
  });

  test('handles empty favourites array', () => {
    let fav = ['bills'];
    applyServerData({ favourites: [] }, v => { fav = v; });
    expect(fav).toEqual([]);
  });

  test('vacations can be a favourite', () => {
    let fav = [];
    applyServerData({ favourites: ['vacations'] }, v => { fav = v; });
    expect(fav).toContain('vacations');
  });
});
