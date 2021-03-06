import { Box, Link } from '@airtable/blocks/ui'
import React from 'react'

const Footer = () => (
  <Box as="footer" display="flex" justifyContent="space-between">
    <Link target="_blank" href="https://console.aito.ai/">
      Aito console
    </Link>
    <Link target="_blank" href="https://aito.ai/privacy-policy/">
      Privacy policy
    </Link>
  </Box>
)

export default Footer
