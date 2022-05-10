import styled from 'styled-components'

const PopupContainer = styled.div`
  height: 100%;

  & .popup {
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease-in-out;
  }

  &:hover .popup {
    z-index: 1000;
    opacity: 1;
    visibility: visible;
  }
`

export default PopupContainer
