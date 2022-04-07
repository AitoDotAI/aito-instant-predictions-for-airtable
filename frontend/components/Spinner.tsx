import { DimensionsSetProps, SpacingSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Box, Loader } from '@airtable/blocks/ui'
import React from 'react'

const Spinner: React.FC<SpacingSetProps & DimensionsSetProps> = (props) => (
  <Box
    padding={3}
    flexGrow={1}
    display="flex"
    flexBasis="100%"
    width="100%"
    {...props}
    justifyContent="center"
    alignItems="center"
  >
    <Loader scale={0.3} />
  </Box>
)

export default Spinner
