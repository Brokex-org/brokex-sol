export const sharedStyle = {
  // Global
  app: { display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#121212', color: '#d1d5db', fontFamily: 'var(--sans)', overflow: 'hidden' },

  // Sidebar
  sidebar: { width: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 0 0.5rem 0', borderRight: '1px solid #374151' },
  logoPlaceholder: { fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem', color: '#fff' },
  navList: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  navLink: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0px', fontSize: '0.65rem', color: '#d1d5db', cursor: 'pointer', height: '60px', width: '100%', boxSizing: 'border-box', textAlign: 'center', textDecoration: 'none' },
  navLinkActive: { color: '#fff', fontWeight: 'bold', backgroundColor: '#1f2937' },
  profileBlock: { marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid #374151', width: '100%', textAlign: 'center', fontSize: '0.7rem', color: '#fff' },

  // Wrappers
  mainContentWrapper: { flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
  mainGrid: { flexGrow: 1, display: 'flex', minHeight: 0 },

  // -- COLONNE GAUCHE --
  leftColumn: { flexGrow: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #374151', minHeight: 0 },

  header: {
    height: '48px',
    flexShrink: 0,
    display: 'flex', alignItems: 'center', padding: '0 1rem', borderBottom: '1px solid #374151', fontSize: '0.9rem'
  },

  chartBookFlex: { display: 'flex', flexDirection: 'row', flexGrow: 1, borderBottom: '1px solid #374151', minHeight: 0 },
  priceChartBlock: { flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #374151' },

  bookBlock: {
    width: '280px',
    flexShrink: 0,
    display: 'flex', flexDirection: 'column' as const, overflowY: 'auto' as const
  },

  positionsTabsBlock: {
    height: '240px',
    flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },

  // -- COLONNE DROITE --
  rightColumn: {
    width: '340px',
    flexShrink: 0,
    display: 'flex', flexDirection: 'column'
  },

  portfolioValueBlock: {
    height: '180px',
    flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #374151'
  },

  orderFormBlock: { flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 },

  // -- BARRE DU BAS --
  bottomBar: {
    height: '34px',
    flexShrink: 0,
    borderTop: '1px solid #374151', display: 'flex', alignItems: 'center', padding: '0 1rem', fontSize: '0.7rem', color: '#9ca3af'
  },

  // Default Page Block
  pageBlock: { flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, fontSize: '1.2rem', color: '#fff' }
};
